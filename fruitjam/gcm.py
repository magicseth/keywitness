# gcm.py - Minimal AES-GCM encryption for CircuitPython
#
# CircuitPython's aesio module provides the AES block cipher (ECB/CBC/CTR)
# but not GCM, so the GCM layer (CTR keystream + GHASH authentication tag)
# is implemented here in pure Python on top of aesio's ECB single-block
# encryption. Matches NIST SP 800-38D for the parameters KeyWitness v2 uses:
# 96-bit nonce, no additional authenticated data, 128-bit tag.
#
# Like ed25519.py, this is prototype-grade: GHASH in Python long-integer
# arithmetic is not constant-time and is slow, but messages here are tiny.

import aesio

_R = 0xE1 << 120  # GCM reduction polynomial


def _encrypt_block(aes, block):
    out = bytearray(16)
    aes.encrypt_into(block, out)
    return bytes(out)


def _gf_mult(x, y):
    """Multiply two 128-bit field elements in GCM's GF(2^128)."""
    z = 0
    v = x
    for i in range(128):
        if (y >> (127 - i)) & 1:
            z ^= v
        if v & 1:
            v = (v >> 1) ^ _R
        else:
            v >>= 1
    return z


def encrypt(key, nonce, plaintext):
    """AES-GCM encrypt. Returns ciphertext with the 16-byte tag appended.

    key: 16/24/32 raw bytes, nonce: exactly 12 bytes (never reuse per key).
    The caller prepends the nonce for the KeyWitness wire format:
    nonce || ciphertext || tag.
    """
    if len(nonce) != 12:
        raise ValueError('nonce must be 12 bytes')
    aes = aesio.AES(key, aesio.MODE_ECB)
    h = int.from_bytes(_encrypt_block(aes, b'\x00' * 16), 'big')
    j0 = nonce + b'\x00\x00\x00\x01'

    # CTR mode keystream, counter starts at inc32(J0)
    ciphertext = b''
    counter = 1
    for i in range(0, len(plaintext), 16):
        counter = (counter + 1) & 0xFFFFFFFF
        keystream = _encrypt_block(aes, nonce + counter.to_bytes(4, 'big'))
        chunk = plaintext[i:i + 16]
        ciphertext += bytes(a ^ b for a, b in zip(chunk, keystream))

    # GHASH over the ciphertext (no AAD), then the lengths block
    y = 0
    for i in range(0, len(ciphertext), 16):
        block = ciphertext[i:i + 16]
        if len(block) < 16:
            block = block + b'\x00' * (16 - len(block))
        y = _gf_mult(int.from_bytes(block, 'big') ^ y, h)
    lengths = (0).to_bytes(8, 'big') + (len(ciphertext) * 8).to_bytes(8, 'big')
    y = _gf_mult(int.from_bytes(lengths, 'big') ^ y, h)

    tag = bytes(a ^ b for a, b in zip(y.to_bytes(16, 'big'),
                                      _encrypt_block(aes, j0)))
    return ciphertext + tag
