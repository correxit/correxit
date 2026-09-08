"""Exercise publication against real Mike builds in disposable repositories."""

import json
import os
from pathlib import Path
import re
from shutil import copyfile
from subprocess import CalledProcessError, STDOUT, check_output
import sys
from tempfile import TemporaryDirectory
import unittest


class Snapshots(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(prefix="correxit-pages-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Pages test",
            "GIT_AUTHOR_EMAIL": "pages@example.invalid",
            "GIT_COMMITTER_NAME": "Pages test",
            "GIT_COMMITTER_EMAIL": "pages@example.invalid",
            "SOURCE_DATE_EPOCH": "1700000000",
            "NO_MKDOCS_2_WARNING": "true",
        }
        for directory in ["site/_docs", "lite/_output"]:
            (self.root / directory).mkdir(parents=True)
        for name in ["snapshot.py", "hooks.py"]:
            copyfile(Path(__file__).with_name(name), self.root / "site" / name)
        self.write("package.json", '{"version": "1.0.0"}')
        self.write("site/_docs/index.md", "# Original\n")
        self.write("site/_docs/guide.md", "# Guide\n")
        self.write("lite/_output/index.html", "Interactive demo\n")
        self.write(
            "site/test.mjs",
            "import { accessSync } from 'node:fs';\n"
            "accessSync(process.env.CORREXIT_SITE_OUTPUT + '/index.html');\n",
        )
        self.write(
            "mkdocs.yml",
            "site_name: Pages test\n"
            "site_url: https://example.invalid/\n"
            "docs_dir: site/_docs\n"
            "site_dir: site/_output\n"
            "theme: {name: material}\n"
            "hooks: [site/hooks.py]\n"
            "plugins:\n"
            "  - search\n"
            "  - mike:\n"
            "      alias_type: redirect\n"
            "      canonical_version: latest\n",
        )
        self.run_command("git", "init", "--quiet")
        self.run_command("git", "add", ".")
        self.run_command("git", "commit", "--quiet", "-m", "Source")

    def write(self, path, content):
        (self.root / path).write_text(content)

    def run_command(self, *args):
        return check_output(args, cwd=self.root, env=self.env, text=True, stderr=STDOUT)

    def publish(self):
        self.run_command(sys.executable, "site/snapshot.py")

    def assert_homepage(self, version, title):
        output = self.root / "site/_pages"
        page = (output / "index.html").read_text()
        self.assertIn(title, page)
        self.assertNotIn('http-equiv="refresh"', page)
        self.assertIn('rel="canonical" href="https://example.invalid/"', page)
        self.assertIn(f'href="{version}/guide/"', page)
        config = json.loads(re.search(r'<script id="__config"[^>]*>(.*?)</script>', page)[1])
        self.assertEqual(config["base"], f"{version}/")
        self.assertTrue((output / config["search"]).is_file())
        self.assertEqual(self.run_command("git", "show", "gh-pages:index.html"), page)
        return page

    def test_latest_follows_releases_and_numbered_snapshots_stay_fixed(self):
        self.publish()
        output = self.root / "site/_pages"
        original = self.run_command("git", "rev-parse", "gh-pages:1.0.0")
        self.assert_homepage("1.0.0", "Original")
        self.assertIn("1.0.0/", (output / "latest/index.html").read_text())
        self.assertEqual((output / "1.0.0/demo/index.html").read_text(), "Interactive demo\n")
        self.assertFalse(any(path.is_symlink() for path in output.rglob("*")))

        self.write("site/_docs/index.md", "# Revised\n")
        self.publish()
        self.assertEqual(
            self.run_command("git", "rev-parse", "gh-pages:1.0.0"), original
        )
        self.assertIn("Original", (output / "1.0.0/index.html").read_text())
        self.assert_homepage("1.0.0", "Original")

        self.write("package.json", '{"version": "1.1.0"}')
        self.publish()
        versions = json.loads((output / "versions.json").read_text())
        self.assertEqual(
            {item["version"] for item in versions}, {"1.0.0", "1.1.0"}
        )
        self.assertIn("1.1.0/", (output / "latest/index.html").read_text())
        self.assertIn("Revised", (output / "1.1.0/index.html").read_text())
        homepage = self.assert_homepage("1.1.0", "Revised")
        self.assertEqual(
            self.run_command("git", "rev-parse", "gh-pages:1.0.0"), original
        )

        # Retrying an unchanged deployment must still produce an uploadable site.
        previous = self.run_command("git", "rev-parse", "gh-pages")
        self.publish()
        self.assertEqual(self.run_command("git", "rev-parse", "gh-pages"), previous)
        self.assertTrue((output / "latest/index.html").is_file())
        self.assertEqual(self.assert_homepage("1.1.0", "Revised"), homepage)

        self.write("package.json", '{"version": "1.0.1"}')
        self.write("site/_docs/index.md", "# Backport\n")
        self.publish()
        self.assertTrue((output / "1.0.1/index.html").is_file())
        self.assertIn("1.1.0/", (output / "latest/index.html").read_text())
        self.assertEqual(self.assert_homepage("1.1.0", "Revised"), homepage)

    def test_existing_alias_and_remote_snapshots_are_preserved(self):
        self.run_command("mike", "deploy", "1.0.0", "latest")
        original = self.run_command("git", "rev-parse", "gh-pages:1.0.0")
        self.run_command("git", "update-ref", "refs/remotes/origin/gh-pages", "gh-pages")
        self.run_command("git", "branch", "-D", "gh-pages")
        self.write("site/_docs/index.md", "# Revised\n")
        self.publish()
        self.assertEqual(
            self.run_command("git", "rev-parse", "gh-pages:1.0.0"), original
        )
        self.assertIn("1.0.0/", (self.root / "site/_pages/latest/index.html").read_text())
        self.assert_homepage("1.0.0", "Original")

    def test_homepage_preserves_text_and_local_anchors(self):
        self.write(
            "site/_docs/index.md",
            '# Café\n\nLiteral `{{ value }}` and `{% raw %}`.\n\n'
            '[Demo](demo/index.html) [Section](#section)\n\n## Section\n',
        )
        self.publish()
        page = self.assert_homepage("1.0.0", "Café")
        self.assertIn("{{ value }}", page)
        self.assertIn("{% raw %}", page)
        self.assertIn('href="1.0.0/demo/index.html"', page)
        self.assertIn('href="#section"', page)

    def test_failed_validation_does_not_create_an_artifact(self):
        self.write("site/test.mjs", "throw new Error('Invalid site');\n")
        with self.assertRaises(CalledProcessError):
            self.publish()
        self.assertFalse((self.root / "site/_pages").exists())


if __name__ == "__main__":
    unittest.main()
