"""HTTP security regression tests for the loopback vision service."""
from __future__ import annotations

import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from server import Handler


class CorsSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_localhost_origins_are_echoed_without_wildcard_or_private_network_grant(self) -> None:
        request = Request(self.base + "/hands", method="OPTIONS", headers={
            "Origin": "http://localhost:4175",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        with urlopen(request) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:4175")
            self.assertNotEqual(response.headers.get("Access-Control-Allow-Origin"), "*")
            self.assertIsNone(response.headers.get("Access-Control-Allow-Private-Network"))

    def test_untrusted_origin_preflight_is_rejected(self) -> None:
        request = Request(self.base + "/hands", method="OPTIONS", headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        })
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 403)
        self.assertIsNone(error.exception.headers.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    unittest.main()
