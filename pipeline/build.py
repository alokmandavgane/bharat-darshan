#!/usr/bin/env python3
"""Run the whole data pipeline in order. `npm run data`, or `python3 pipeline/build.py`.

Steps are separate scripts so one can be re-run alone; each caches its raw downloads
under pipeline/raw/ (git-ignored). Options after `--` go to every step, e.g.
`python3 pipeline/build.py -- --tiers 1024`.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = ['01_boundaries.py', '02_dem.py', '05_manifest.py']


def main():
    extra = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for step in STEPS:
        print(f'== {step}')
        args = [sys.executable, os.path.join(HERE, step)]
        if step != '05_manifest.py':
            args += extra
        subprocess.run(args, check=True)


if __name__ == '__main__':
    main()
