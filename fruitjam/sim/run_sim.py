"""Run the unmodified fruitjam code.py on the desktop.

    python3 run_sim.py --settings path/to/settings.toml \
        [--text "hello"] [--start-slot 1] [--end-slot 1]

Slots: 1/111 etc. per your settings; 0 = unenrolled finger; button = use
the button instead of a touch. Posts REAL attestations to the backend.
"""

import argparse
import os
import sys
import threading
import time

SIM_DIR = os.path.dirname(os.path.abspath(__file__))
FRUITJAM_DIR = os.path.dirname(SIM_DIR)
sys.path.insert(0, SIM_DIR)        # aesio shim
sys.path.insert(0, FRUITJAM_DIR)   # ed25519, gcm, sha512

import sim_hardware


def load_settings(path):
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ[key.strip()] = value.strip().strip('"')


def scenario(sim, args):
    try:
        sim.wait_ready()
        time.sleep(0.5)

        if args.start_slot == "button":
            sim.press_button()
        else:
            sim.touch(int(args.start_slot))
        time.sleep(0.8)

        sim.type(args.text)
        time.sleep(1.2)

        if args.end_slot == "button":
            sim.press_button()
        else:
            sim.touch(int(args.end_slot))

        sim.wait_host_contains("http", timeout=120)
        time.sleep(0.5)
    except Exception as e:
        sim.log("scenario error:", e)
    finally:
        sim.stop = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--settings", required=True)
    ap.add_argument("--text", default="hello from the simulator")
    ap.add_argument("--start-slot", default="1")
    ap.add_argument("--end-slot", default="1")
    args = ap.parse_args()

    load_settings(args.settings)

    sim = sim_hardware.SimState()
    sim_hardware.install(sim)

    t = threading.Thread(target=scenario, args=(sim, args), daemon=True)
    t.start()

    code = open(os.path.join(FRUITJAM_DIR, "code.py")).read()
    try:
        exec(compile(code, "code.py", "exec"), {"__name__": "__main__"})
    except SystemExit:
        pass

    print()
    print("[sim] ── result ──────────────────────────────────────────")
    print("[sim] host computer received:")
    print(sim.host_text)


if __name__ == "__main__":
    main()
