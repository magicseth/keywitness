"""Desktop shim for CircuitPython's aesio: ECB single-block encrypt only."""

MODE_ECB = 1

_SBOX = None

def _build_sbox():
    global _SBOX
    if _SBOX is not None:
        return _SBOX
    # Generate the AES S-box from GF(2^8) inverses + affine transform
    p, q = 1, 1
    sbox = [0] * 256
    while True:
        # multiply p by 3
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)
        # divide q by 3
        q ^= (q << 1) & 0xFF
        q ^= (q << 2) & 0xFF
        q ^= (q << 4) & 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4))
        sbox[p] = (x ^ 0x63) & 0xFF
        if p == 1:
            break
    sbox[0] = 0x63
    _SBOX = sbox
    return sbox


def _xtime(a):
    a <<= 1
    if a & 0x100:
        a = (a ^ 0x1B) & 0xFF
    return a


class AES:
    def __init__(self, key, mode=MODE_ECB, IV=None, segment_size=8):
        assert mode == MODE_ECB
        self._sbox = _build_sbox()
        self._round_keys = self._expand_key(bytes(key))

    def _expand_key(self, key):
        sbox = self._sbox
        nk = len(key) // 4
        nr = nk + 6
        w = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
        rcon = 1
        for i in range(nk, 4 * (nr + 1)):
            temp = list(w[i - 1])
            if i % nk == 0:
                temp = temp[1:] + temp[:1]
                temp = [sbox[b] for b in temp]
                temp[0] ^= rcon
                rcon = _xtime(rcon)
            elif nk > 6 and i % nk == 4:
                temp = [sbox[b] for b in temp]
            w.append([w[i - nk][j] ^ temp[j] for j in range(4)])
        self._nr = nr
        return w

    def encrypt_into(self, src, dest):
        sbox = self._sbox
        w = self._round_keys
        nr = self._nr
        # state[col][row]
        state = [list(src[4 * c:4 * c + 4]) for c in range(4)]

        def add_round_key(rnd):
            for c in range(4):
                for r in range(4):
                    state[c][r] ^= w[4 * rnd + c][r]

        def sub_bytes():
            for c in range(4):
                for r in range(4):
                    state[c][r] = sbox[state[c][r]]

        def shift_rows():
            for r in range(1, 4):
                row = [state[c][r] for c in range(4)]
                row = row[r:] + row[:r]
                for c in range(4):
                    state[c][r] = row[c]

        def mix_columns():
            for c in range(4):
                a = state[c]
                t = a[0] ^ a[1] ^ a[2] ^ a[3]
                u = a[0]
                a[0] ^= t ^ _xtime(a[0] ^ a[1])
                a[1] ^= t ^ _xtime(a[1] ^ a[2])
                a[2] ^= t ^ _xtime(a[2] ^ a[3])
                a[3] ^= t ^ _xtime(a[3] ^ u)

        add_round_key(0)
        for rnd in range(1, nr):
            sub_bytes()
            shift_rows()
            mix_columns()
            add_round_key(rnd)
        sub_bytes()
        shift_rows()
        add_round_key(nr)

        out = bytes(state[c][r] for c in range(4) for r in range(4))
        dest[:] = out
