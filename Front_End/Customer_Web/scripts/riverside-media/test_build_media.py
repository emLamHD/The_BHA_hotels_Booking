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

    def test_a_generator_marker_wins_over_editor_metadata(self):
        self.assertEqual(bm.scan(b"Photoshop gpt-image", None)["classification"], "generator-markers-present")

    def test_the_decision_never_claims_verification(self):
        # Publication is the Owner's; the wording says so and never says the picture is a verified photograph.
        for classification in ("editor-metadata-present", "generator-markers-present", "no-metadata", "content-credentials-detected"):
            decision = bm.decision_for(classification)
            self.assertTrue(decision.startswith("owner-"), decision)
            self.assertNotIn("verified photo", decision.replace("not independently verified", ""))
        self.assertIn("unverified", bm.decision_for("generator-markers-present"))


class ManifestTests(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "manifest.json"), encoding="utf-8") as handle:
            self.manifest = json.load(handle)

    def test_counts_add_up_and_validation_is_declared_not_run(self):
        m = self.manifest
        self.assertEqual(sum(m["originalsByClassification"].values()), m["originalsAudited"])
        self.assertEqual(len(m["published"]) + len(m["excluded"]), m["originalsAudited"])
        self.assertIn("NOT_RUN", m["evidenceLevel"])

    def test_every_published_file_records_its_scan_and_the_owners_decision_and_is_unverified(self):
        for entry in self.manifest["published"]:
            self.assertEqual(entry["evidence"]["validation"], "NOT_RUN", entry["derivative"])
            self.assertEqual(entry["provenanceStatus"], "UNVERIFIED", entry["derivative"])
            self.assertTrue(entry["decision"].startswith("owner-"), entry["derivative"])
            if entry["evidence"]["classification"] != bm.PUBLISHABLE:
                self.assertTrue(entry["decision"].startswith("owner-authorized"), entry["derivative"])

    def test_no_original_is_published_twice(self):
        hashes = [e["sourceSha256"] for e in self.manifest["published"]]
        self.assertEqual(len(hashes), len(set(hashes)))

    def test_every_room_type_has_an_interior_cover_and_five_pictures(self):
        by_owner = {}
        for entry in self.manifest["published"]:
            if entry["ownerType"] == "room-type":
                by_owner.setdefault(entry["ownerCode"], []).append(entry)
        self.assertEqual(sorted(by_owner), ["RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR"])
        for code, entries in by_owner.items():
            self.assertGreaterEqual(len(entries), 5, code)
            covers = [e for e in entries if e["isCover"]]
            self.assertEqual(len(covers), 1, code)
            self.assertNotIn("balcony", covers[0]["derivative"])
            self.assertNotIn("skyline", covers[0]["derivative"])
            self.assertEqual(len({e["sortOrder"] for e in entries}), len(entries), code)

    def test_earlier_entries_keep_their_position_so_media_ids_stay_stable(self):
        first = [e["derivative"] for e in self.manifest["published"][:13]]
        self.assertEqual(first[0], "entrance-logo.webp")
        self.assertEqual(first[10:], ["two-bedroom-balcony-view.webp", "two-bedroom-skyline-1.webp", "two-bedroom-skyline-2.webp"])

    def test_no_manifest_text_claims_verified_camera_provenance(self):
        text = json.dumps(self.manifest, ensure_ascii=False).lower()
        for claim in ("camera photo", "verified signature", "cryptographically", "no ai credentials"):
            self.assertNotIn(claim, text)


if __name__ == "__main__":
    unittest.main()
