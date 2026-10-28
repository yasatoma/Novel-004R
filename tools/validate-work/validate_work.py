#!/usr/bin/env python3
"""Read-only pre-push validator for ChappyNovelEngine work repositories."""

from __future__ import annotations
import argparse, json, os, re, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path

DEFAULT_FACTORY_ROOT = Path(r"C:\Users\TOMATO\source\repos\_codex\NovelGameFactory")
CONFIG_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "config.schema.json"
ASSETS_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "assets.schema.json"
SCENARIO_VALIDATOR_PATH = Path(__file__).resolve().with_name("validate_scenario.mjs")
DATA_SCHEMA_PATHS = {
    "content/data/endings.json": Path(__file__).resolve().parents[2] / "schemas" / "endings.schema.json",
    "content/data/memo.json": Path(__file__).resolve().parents[2] / "schemas" / "memo.schema.json",
    "content/data/ruby.json": Path(__file__).resolve().parents[2] / "schemas" / "ruby.schema.json",
    "content/data/characters.json": Path(__file__).resolve().parents[2] / "schemas" / "characters.schema.json",
}
WORK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
REF_RE = re.compile(r"""(?i)(?:^|[\s"'=:(])((?:\.\.?/)?(?:content/)?[^\s"'<>]+\.(?:webp|png|jpg|jpeg|svg|dat|json|txt|css|js|html))""")

class Validator:
    def __init__(self, root: Path):
        self.root=root; self.errors=[]; self.warnings=[]; self.info=[]
    def add(self, level, code, group, message, **detail):
        getattr(self, level).append({"code":code,"group":group,"message":message,**detail})
    def error(self,*a,**k): self.add("errors",*a,**k)
    def warn(self,*a,**k): self.add("warnings",*a,**k)
    def validate_schema(self, data, schema, rel, group, path="$"):
        """Validate the JSON Schema subset used by this repository's schemas."""
        if "oneOf" in schema:
            matches = []
            for candidate in schema["oneOf"]:
                probe = Validator(self.root)
                probe.validate_schema(data, candidate, rel, group, path)
                if not probe.errors:
                    matches.append(candidate)
            if len(matches) != 1:
                self.error("JSON_SCHEMA", group, f"{rel}: {path} must match exactly one schema", path=rel,field=path)
            return
        expected=schema.get("type")
        type_ok={
            "object": isinstance(data,dict),
            "string": isinstance(data,str),
            "array": isinstance(data,list),
            "boolean": isinstance(data,bool),
            "number": isinstance(data,(int,float)) and not isinstance(data,bool),
            "integer": isinstance(data,int) and not isinstance(data,bool),
            "null": data is None,
        }
        if expected and not type_ok.get(expected,True):
            self.error("JSON_SCHEMA",group,f"{rel}: {path} must be {expected}",path=rel,field=path); return
        if "const" in schema and data != schema["const"]:
            self.error("JSON_SCHEMA",group,f"{rel}: {path} must be {schema['const']!r}",path=rel,field=path)
        if "enum" in schema and data not in schema["enum"]:
            self.error("JSON_SCHEMA",group,f"{rel}: {path} has unsupported value: {data!r}",path=rel,field=path)
        if isinstance(data,str):
            if "minLength" in schema and len(data) < schema["minLength"]:
                self.error("JSON_SCHEMA",group,f"{rel}: {path} is shorter than minLength {schema['minLength']}",path=rel,field=path)
            if "pattern" in schema and re.search(schema["pattern"],data) is None:
                self.error("JSON_SCHEMA",group,f"{rel}: {path} does not match required pattern",path=rel,field=path)
        if isinstance(data,dict):
            if "minProperties" in schema and len(data) < schema["minProperties"]:
                self.error("JSON_SCHEMA",group,f"{rel}: {path} has fewer than {schema['minProperties']} properties",path=rel,field=path)
            props=schema.get("properties",{})
            for key in schema.get("required",[]):
                if key not in data:
                    self.error("JSON_SCHEMA",group,f"{rel}: {path}.{key} is required",path=rel,field=f"{path}.{key}")
            additional=schema.get("additionalProperties",True)
            for key,value in data.items():
                child=f"{path}.{key}"
                if key in props:
                    self.validate_schema(value,props[key],rel,group,child)
                elif additional is False:
                    self.error("JSON_SCHEMA",group,f"{rel}: {child} is not allowed",path=rel,field=child)
                elif isinstance(additional,dict):
                    self.validate_schema(value,additional,rel,group,child)
    def load_schema(self, schema_path, group):
        try:
            return json.loads(schema_path.read_text(encoding="utf-8"))
        except Exception as e:
            self.error("SCHEMA_UNAVAILABLE",group,f"schema unavailable: {schema_path}",path=str(schema_path),detail=str(e)); return None
    def load_json(self, rel, required=True):
        p=self.root/rel
        if not p.is_file():
            if required: self.error("FILE_MISSING","structure",f"required file missing: {rel}",path=rel)
            return None
        try: return json.loads(p.read_text(encoding="utf-8-sig"))
        except Exception as e:
            self.error("JSON_INVALID","json",f"invalid JSON: {rel}",path=rel,detail=str(e)); return None
    def exact_file(self, rel, group, source=None):
        rel=rel.replace("\\","/").lstrip("./")
        parts=[p for p in rel.split("/") if p]
        cur=self.root
        for i,part in enumerate(parts):
            if not cur.is_dir():
                self.error("REF_MISSING",group,f"referenced path does not exist: {rel}",path=rel,source=source); return False
            names={p.name:p for p in cur.iterdir()}
            if part not in names:
                folded=[n for n in names if n.casefold()==part.casefold()]
                code="REF_CASE_MISMATCH" if folded else "REF_MISSING"
                msg=(f"path case mismatch: {rel} (actual: {folded[0]})" if folded else f"referenced path does not exist: {rel}")
                self.error(code,group,msg,path=rel,source=source); return False
            cur=names[part]
        if not cur.is_file():
            self.error("REF_MISSING",group,f"referenced file does not exist: {rel}",path=rel,source=source); return False
        return True
    def required_structure(self):
        for rel in ["index.html",".nojekyll","engine/index.html","engine/js","engine/css","content","content/scenario","content/images","content/audio","content/data","content/theme.css","content/data/config.json","content/data/about.html","content/data/credits.html","build-manifest.json"]:
            p=self.root/rel
            if not p.exists(): self.error("PATH_MISSING","structure",f"required path missing: {rel}",path=rel)
    def validate_config(self):
        rel="content/data/config.json"
        c=self.load_json(rel)
        if not isinstance(c,dict): return
        schema=self.load_schema(CONFIG_SCHEMA_PATH,"config")
        if schema is None: return
        self.validate_schema(c,schema,rel,"config")
        if c.get("workId") and c["workId"]!=self.root.name:
            self.error("WORK_ID_MISMATCH","config",f"config workId {c['workId']!r} != folder {self.root.name!r}",path=rel)
        refs=[]
        if c.get("entryScenario"): refs.append(("content/"+str(c["entryScenario"]).lstrip("/"),"entryScenario"))
        if c.get("titleImage"): refs.append(("content/images/title/"+Path(str(c["titleImage"])).name,"titleImage"))
        if c.get("titleBgm"): refs.append(("content/audio/bgm/"+Path(str(c["titleBgm"])).name,"titleBgm"))
        for target,key in refs: self.exact_file(target,"config",f"{rel}:{key}")

    def validate_assets(self):
        rel="content/data/assets.json"
        a=self.load_json(rel)
        if not isinstance(a,dict): return
        schema=self.load_schema(ASSETS_SCHEMA_PATH,"assets")
        if schema is None: return
        self.validate_schema(a,schema,rel,"assets")
        b=a.get("backgrounds",{})
        if isinstance(b,dict):
            for bid,val in b.items():
                vals=[val] if isinstance(val,str) else list(val.values()) if isinstance(val,dict) else []
                for fn in vals:
                    if isinstance(fn,str) and fn: self.exact_file("content/images/bg/"+fn,"assets",f"background:{bid}")
        ch=a.get("characters",{})
        if isinstance(ch,dict):
            for cid,val in ch.items():
                if not isinstance(val,dict): continue
                ex=val.get("expressions",{})
                if not isinstance(ex,dict): continue
                for name,fn in ex.items():
                    if isinstance(fn,str) and fn: self.exact_file("content/images/char/"+fn,"assets",f"character:{cid}:{name}")

    def validate_other_data(self):
        for rel,schema_path in DATA_SCHEMA_PATHS.items():
            data=self.load_json(rel,required=False)
            if data is None: continue
            schema=self.load_schema(schema_path,"data")
            if schema is not None: self.validate_schema(data,schema,rel,"data")

    def validate_character_images(self):
        data=self.load_json("content/data/characters.json",required=False)
        if not isinstance(data,dict): return
        for chapter_id,snapshot in data.items():
            if not isinstance(snapshot,dict): continue
            for character_id,entry in snapshot.items():
                if not isinstance(entry,dict): continue
                image=entry.get("image")
                if isinstance(image,str) and image:
                    self.exact_file("content/images/char/"+Path(image).name,"data",f"characters:{chapter_id}:{character_id}")

    def validate_scenario(self):
        config=self.load_json("content/data/config.json",required=False)
        assets=self.load_json("content/data/assets.json",required=False)
        memos=self.load_json("content/data/memo.json",required=False)
        endings=self.load_json("content/data/endings.json",required=False)
        if not all(isinstance(x,dict) for x in [config,assets,memos,endings]): return
        entry=config.get("entryScenario")
        if not isinstance(entry,str) or not entry: return
        scenario=self.root/"content"/entry
        if not scenario.is_file(): return
        resources={"assets":assets,"memos":memos,"endings":endings}
        try:
            with tempfile.NamedTemporaryFile("w",encoding="utf-8",suffix=".json",delete=False) as tmp:
                json.dump(resources,tmp,ensure_ascii=False); resource_path=tmp.name
            result=subprocess.run(["node",str(SCENARIO_VALIDATOR_PATH),str(scenario),resource_path,entry],capture_output=True,text=True,encoding="utf-8",timeout=30)
            try: payload=json.loads(result.stdout or "{}")
            except json.JSONDecodeError: payload={}
            if result.returncode!=0:
                self.error("SCENARIO_INVALID","scenario",payload.get("message") or result.stderr.strip() or "scenario validation failed",path="content/"+entry)
        except FileNotFoundError:
            self.error("VALIDATOR_UNAVAILABLE","scenario","Node.js is required for scenario validation")
        except Exception as e:
            self.error("VALIDATOR_UNAVAILABLE","scenario",f"scenario validator unavailable: {e}")
        finally:
            if 'resource_path' in locals():
                try: Path(resource_path).unlink()
                except OSError: pass

    def scan_text_refs(self):
        scenario=self.root/"content/scenario"
        if not scenario.is_dir(): return
        for p in scenario.rglob("*"):
            if not p.is_file(): continue
            try: lines=p.read_text(encoding="utf-8-sig").splitlines()
            except UnicodeDecodeError:
                self.error("TEXT_ENCODING","scenario",f"scenario is not UTF-8: {p.relative_to(self.root)}"); continue
            for no,line in enumerate(lines,1):
                overlay_match=re.search(r"@overlay\s+show\b[^\n]*\bid=(I\d{3})\b",line,re.IGNORECASE)
                if overlay_match:
                    self.exact_file(f"content/images/item/{overlay_match.group(1).upper()}.webp","scenario",f"{p.relative_to(self.root)}:{no}")
                for m in REF_RE.finditer(line):
                    ref=m.group(1).rstrip(",;)")
                    if ref.startswith(("http://","https://")): continue
                    rel=ref.lstrip("./")
                    if not rel.startswith("content/"):
                        if rel.startswith(("images/","audio/","data/","scenario/")): rel="content/"+rel
                        elif re.fullmatch(r"[^/\\]+\.dat",rel,re.IGNORECASE):
                            audio_match=re.search(r"@(?:bgm|ambient|se)\s+play\b[^\n]*\bfile=(?:\"([^\"]+)\"|'([^']+)'|([^\s]+))",line,re.IGNORECASE)
                            if not audio_match: continue
                            filename=next(x for x in audio_match.groups() if x is not None)
                            kind=re.search(r"@(bgm|ambient|se)\s+play\b",line,re.IGNORECASE).group(1).lower()
                            folder={"bgm":"bgm","ambient":"ambient","se":"se"}[kind]
                            rel=f"content/audio/{folder}/{Path(filename).name}"
                        else: continue
                    self.exact_file(rel,"scenario",f"{p.relative_to(self.root)}:{no}")
    def unused_assets(self):
        # Deliberately conservative: report counts only; do not guess semantic usage.
        for rel in ["content/images/bg","content/images/char","content/images/title","content/images/item","content/audio/bgm","content/audio/ambient","content/audio/se"]:
            p=self.root/rel
            if p.is_dir():
                n=sum(1 for x in p.rglob("*") if x.is_file())
                self.info.append({"code":"FILE_COUNT","group":rel,"message":f"{rel}: {n} files","count":n})
    def run(self):
        self.required_structure()
        # Presence is already checked by required_structure(); parse only when present
        # so one missing file is reported as one validation error.
        if (self.root/"build-manifest.json").is_file():
            self.load_json("build-manifest.json", required=False)
        self.validate_config(); self.validate_assets(); self.validate_other_data(); self.validate_character_images(); self.validate_scenario(); self.scan_text_refs(); self.unused_assets()
        return not self.errors

def compact(items):
    groups=defaultdict(list)
    for x in items: groups[x.get("group","other")].append(x)
    return [{"group":g,"count":len(v),"example":v[0]} for g,v in sorted(groups.items())]

def main():
    ap=argparse.ArgumentParser(description="Read-only pre-push validation of a CNE work repository.")
    ap.add_argument("work_id"); ap.add_argument("--factory-root",type=Path,default=Path(os.environ.get("NOVEL_GAME_FACTORY_ROOT",DEFAULT_FACTORY_ROOT)))
    ap.add_argument("--full",action="store_true",help="emit every diagnostic instead of grouped examples")
    args=ap.parse_args()
    if not WORK_ID_RE.fullmatch(args.work_id):
        print(json.dumps({"success":False,"errors":[{"code":"WORK_ID_INVALID","message":"invalid work_id"}]},ensure_ascii=False)); return 2
    root=(args.factory_root/args.work_id).resolve()
    if not root.is_dir():
        print(json.dumps({"success":False,"errors":[{"code":"WORK_ROOT_MISSING","message":f"work folder not found: {root}"}]},ensure_ascii=False)); return 2
    v=Validator(root); ok=v.run()
    result={"success":ok,"workId":args.work_id,"target":str(root),"summary":{"errors":len(v.errors),"warnings":len(v.warnings),"info":len(v.info)}}
    if args.full: result.update(errors=v.errors,warnings=v.warnings,info=v.info)
    else: result.update(errors=compact(v.errors),warnings=compact(v.warnings),info=compact(v.info))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if ok else 1

if __name__=="__main__": raise SystemExit(main())
