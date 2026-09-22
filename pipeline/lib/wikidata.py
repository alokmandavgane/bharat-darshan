"""Asking Wikidata, in the one way that survives a long build.

The public query service is generous and slow: a query over a few hundred ids can take a
minute, and a build that asks it forty times will meet a timeout or a throttle at least
once. So every question is posted (a URL long enough to carry three hundred ids is long
enough to be refused), retried with a widening pause, and -- the part that matters --
cached one batch at a time under the ids that batch asked about. A run interrupted in the
middle resumes where it stopped instead of starting the hour again.
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from . import fetch

ENDPOINT = 'https://query.wikidata.org/sparql'
BATCH = 100          # ids per query: small enough that the service answers inside a minute
TRIES = 4
PAUSE = 4.0          # seconds before the first retry, doubling


def ask(query, timeout=180):
    """Run one SPARQL query. Returns its bindings."""
    data = urllib.parse.urlencode({'query': query, 'format': 'json'}).encode()
    req = urllib.request.Request(ENDPOINT, data=data, headers={
        'User-Agent': fetch.USER_AGENT, 'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded'})
    wait = PAUSE
    for attempt in range(TRIES):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)['results']['bindings']
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt == TRIES - 1:
                raise
            print(f'    wikidata: {type(e).__name__}, retrying in {wait:.0f}s')
            time.sleep(wait)
            wait *= 2
    return []


def batched(ids, query_for, cache_dir, prefix, label='ids'):
    """
    Ask about a long list of ids a batch at a time, caching each batch on disk.

    `query_for` is given one batch and returns the SPARQL for it. Returns every binding
    from every batch, in order.
    """
    os.makedirs(cache_dir, exist_ok=True)
    ids = sorted(set(ids))
    rows = []
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i + BATCH]
        key = hashlib.sha1(('\x00'.join(batch)).encode()).hexdigest()[:16]
        path = os.path.join(cache_dir, f'{prefix}-{key}.json')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                rows += json.load(f)
            continue
        got = ask(query_for(batch))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(got, f, ensure_ascii=False, separators=(',', ':'))
        rows += got
        print(f'    wikidata: {min(i + BATCH, len(ids))} of {len(ids)} {label} looked up', flush=True)
    return rows
