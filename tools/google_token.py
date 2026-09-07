"""Access token для Google Cloud по ключу сервисного аккаунта из ~/.config/qazaq-trainer/google.json (без внешних библиотек).
Ключ читается только здесь, никуда не копируется."""
import json, time, base64, pathlib, os, urllib.request, urllib.parse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

KEY = pathlib.Path(os.path.expanduser('~/.config/qazaq-trainer/google.json'))
SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

def _b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=')

def token():
    sa = json.loads(KEY.read_text())
    now = int(time.time())
    hdr = _b64(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claims = _b64(json.dumps({'iss': sa['client_email'], 'scope': SCOPE, 'aud': sa['token_uri'], 'iat': now, 'exp': now + 3600}).encode())
    signing = hdr + b'.' + claims
    key = serialization.load_pem_private_key(sa['private_key'].encode(), password=None)
    sig = key.sign(signing, padding.PKCS1v15(), hashes.SHA256())
    jwt = signing + b'.' + _b64(sig)
    body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': jwt.decode()}).encode()
    r = urllib.request.urlopen(urllib.request.Request(sa['token_uri'], data=body), timeout=30)
    return json.loads(r.read())['access_token']
