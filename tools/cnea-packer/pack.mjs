import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FORMATS=new Map([[".ogg",0x01],[".mp3",0x02],[".wav",0x03]]);
const MAGIC=Buffer.from([0x43,0x4e,0x45,0x41,0x01]);
const DEFAULT_FACTORY_ROOT=String.raw`C:\Users\TOMATO\source\repos\_codex\NovelGameFactory`;

async function packFile(input,output){
  const ext=path.extname(input).toLowerCase();
  if(!FORMATS.has(ext))throw new Error("unsupported audio format: "+ext);
  const payload=await readFile(input);
  await mkdir(path.dirname(output),{recursive:true});
  await writeFile(output,Buffer.concat([MAGIC,Buffer.from([FORMATS.get(ext)]),payload]));
}

async function singleMode(inputArg,outputArg){
  const input=path.resolve(inputArg);
  const output=outputArg
    ? path.resolve(path.dirname(input),outputArg.toLowerCase().endsWith(".dat")?outputArg:outputArg+".dat")
    : path.join(path.dirname(input),path.basename(input,path.extname(input))+".dat");
  await packFile(input,output);
  console.log("CNEA: "+input+" -> "+output);
}

async function bulkMode(workId){
  if(!workId)throw new Error("work id is required (example: Novel-005)");
  if(/[\\/]/.test(workId))throw new Error("work id must be a folder name, not a path: "+workId);

  const factoryRoot=path.resolve(process.env.NOVEL_GAME_FACTORY_ROOT??DEFAULT_FACTORY_ROOT);
  const inputRoot=path.join(factoryRoot,"Common","audio");
  const outputRoot=path.join(factoryRoot,workId,"content","audio");

  async function files(dir){
    try{
      return (await readdir(dir,{withFileTypes:true}))
        .filter(x=>x.isFile()&&FORMATS.has(path.extname(x.name).toLowerCase()))
        .map(x=>x.name)
        .sort((a,b)=>a.localeCompare(b,"ja",{numeric:true,sensitivity:"base"}));
    }catch(e){
      if(e.code==="ENOENT")return [];
      throw e;
    }
  }

  async function convert(kind,prefix,map){
    const names=await files(path.join(inputRoot,kind));
    if(names.length>999)throw new Error(kind+": 999 files maximum");
    const outputDir=path.join(outputRoot,kind);
    await mkdir(outputDir,{recursive:true});
    for(let i=0;i<names.length;i++){
      const original=names[i];
      const packed=prefix+String(i+1).padStart(3,"0")+".dat";
      await packFile(path.join(inputRoot,kind,original),path.join(outputDir,packed));
      map.push(kind.toUpperCase()+"\t"+original+"\t"+packed);
    }
  }

  const map=["type\toriginal\tpacked"];
  await convert("bgm","B",map);
  await convert("ambient","A",map);
  await convert("se","S",map);
  await mkdir(outputRoot,{recursive:true});
  await writeFile(path.join(outputRoot,"map.txt"),map.join("\n")+"\n","utf8");
  console.log("CNEA: "+(map.length-1)+" file(s) -> "+outputRoot);
}

try{
  const first=process.argv[2], second=process.argv[3];
  if(first&&FORMATS.has(path.extname(first).toLowerCase()))await singleMode(first,second);
  else await bulkMode(first);
}catch(e){
  console.error(e.message);
  process.exitCode=1;
}
