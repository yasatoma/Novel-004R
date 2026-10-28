import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

spec = importlib.util.spec_from_file_location(
    "normalize_images", Path(__file__).with_name("normalize_images.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.JSON_MODE = True


class CharacterNamingTests(unittest.TestCase):
    def run_case(self, names):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "Image-master" / "Character"
            source.mkdir(parents=True)
            for name, height in names.items():
                Image.new("RGBA", (10, height), (255, 0, 0, 255)).save(
                    source / f"CH_001_{name}.png"
                )
            originals = {p.name: p.read_bytes() for p in source.iterdir()}
            with patch.object(module, "CHARACTER_CANVAS_SIZE", (100, 100)), \
                 patch.object(module, "CHARACTER_BASE_HEIGHT", 50):
                count = module.normalize_character(root, "CH_001", 1, 85)
            outputs = {}
            for path in (root / "Image" / "Character").glob("*.webp"):
                with Image.open(path) as image:
                    self.assertEqual(image.size, (100, 100))
                    self.assertEqual(image.mode, "RGBA")
                    bbox = image.getchannel("A").getbbox()
                    outputs[path.stem] = bbox[3] - bbox[1]
            self.assertEqual(originals, {p.name: p.read_bytes() for p in source.iterdir()})
            self.assertEqual(count, len(names))
            return outputs

    def test_current_name(self):
        self.assertEqual(self.run_case({"通常": 20})["CH_001_通常"], 50)

    def test_legacy_name(self):
        self.assertEqual(self.run_case({"基本": 20})["CH_001_基本"], 50)

    def test_current_name_wins_when_both_exist(self):
        outputs = self.run_case({"通常": 20, "基本": 10})
        self.assertEqual(outputs["CH_001_通常"], 50)
        self.assertEqual(outputs["CH_001_基本"], 25)

    def test_missing_reference_is_error(self):
        with self.assertRaisesRegex(module.ToolError, "通常.png.*基本.png"):
            self.run_case({"笑顔": 20})


if __name__ == "__main__":
    unittest.main()
