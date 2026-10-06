"""Tests for the provenance scan in build_media.py. Run: python3 -m unittest test_build_media -v

They pin what the scan may claim: markers are reported as found, a generic C2PA container is not
called AI, editor metadata is not called camera-verified, and validation is never reported as run.
"""
import json
import os
import unittest

import build_media as bm

HERE = os.path.dirname(os.path.abspath(__file__))


class ScanTests(unittest.TestCase):
    def test_generic_c2pa_container_is_not_classified_as_generated(self):
        result = bm.scan(b"....jumb....c2pa....caBX....", None)
        self.assertEqual(result["classification"], "content-credentials-detected")
        self.assertEqual(result["markers"], ["c2pa", "caBX", "jumb"])

    def test_explicit_generator_markers_are_listed_exactly(self):
        result = bm.scan(b"c2pa trainedAlgorithmicMedia OpenAI Media Service", None)
        self.assertEqual(result["classification"], "generator-markers-present")
        self.assertEqual(result["markers"], ["trainedAlgorithmicMedia", "OpenAI Media Service", "c2pa"])
        self.assertNotIn("gpt-image", result["markers"])  # not present, so not reported

    def test_editor_metadata_is_not_camera_verified(self):
        for data, software in ((b"..Adobe Lightroom..", None), (b"..Photoshop..", None), (b"", "Some Editor 1.0")):
            result = bm.scan(data, software)
            self.assertEqual(result["classification"], bm.PUBLISHABLE)
            self.assertNotIn("camera", result["classification"])
            self.assertIn("not independently verified", bm.NOTES[result["classification"]])

    def test_no_metadata_is_unverified(self):
        result = bm.scan(b"\xff\xd8\xff plain bytes", None)
        self.assertEqual(result["classification"], "no-metadata")
        self.assertEqual(result["markers"], [])

    def test_validation_is_never_reported_as_run(self):
        for data in (b"", b"c2pa", b"gpt-image", b"Photoshop"):
            self.assertEqual(bm.scan(data, None)["validation"], "NOT_RUN")

    def test_only_editor_metadata_is_publishable(self):
        for data in (b"gpt-image", b"c2pa", b""):
            self.assertNotEqual(bm.scan(data, None)["classification"], bm.PUBLISHABLE)
        # a generator marker wins over editor metadata
        self.assertEqual(bm.scan(b"Photoshop gpt-image", None)["classification"], "generator-markers-present")


class ManifestTests(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "manifest.json"), encoding="utf-8") as handle:
            self.manifest = json.load(handle)

    def test_counts_add_up_and_validation_is_declared_not_run(self):
        m = self.manifest
        self.assertEqual(sum(m["originalsByClassification"].values()), m["originalsAudited"])
        self.assertEqual(len(m["published"]) + len(m["excluded"]), m["originalsAudited"])
        self.assertIn("NOT_RUN", m["evidenceLevel"])

    def test_every_published_file_is_editor_metadata_without_credentials_or_generator_markers(self):
        for entry in self.manifest["published"]:
            evidence = entry["evidence"]
            self.assertEqual(evidence["classification"], bm.PUBLISHABLE, entry["derivative"])
            self.assertEqual(evidence["validation"], "NOT_RUN")
            self.assertFalse({"c2pa", "caBX", "jumb", *(x.decode() for x in bm.GENERATOR_MARKERS)} & set(evidence["markers"]))

    def test_no_excluded_file_shares_a_hash_with_a_published_one_unless_selected_elsewhere(self):
        published = {e["sourceSha256"] for e in self.manifest["published"]}
        for entry in self.manifest["excluded"]:
            if entry["classification"] != bm.PUBLISHABLE:
                self.assertNotIn(entry["sha256"], published)

    def test_no_manifest_text_claims_verified_camera_provenance(self):
        text = json.dumps(self.manifest, ensure_ascii=False).lower()
        for claim in ("camera photo", "verified signature", "cryptographically", "no ai credentials"):
            self.assertNotIn(claim, text)


if __name__ == "__main__":
    unittest.main()
