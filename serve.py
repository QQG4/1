#!/usr/bin/env python3
"""Статический сервер для docs/ (сборка сайта) (порт из переменной PORT, по умолчанию 8765)."""
import os, functools, http.server
port = int(os.environ.get('PORT', '8765'))
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docs')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
handler = functools.partial(H, directory=root)
print('serving', root, 'on', port, flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
