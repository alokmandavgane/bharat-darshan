"""The source registry: content/sources.json, read once and enforced everywhere.

PLAN.md section 5, "Source registry". With dozens of datasets, attribution per layer
stops scaling -- the same census feeds ten layers -- so each source is declared once
and cited by id. This module is what the build checks citations against.

What it enforces, and why each rule is here:
  * a cited id must exist. A renamed source would otherwise leave a layer silently
    uncredited, which is the failure mode the registry exists to prevent.
  * `use: data` or `software` means bytes derived from it ship, so its licence must
    permit redistribution. This is the check that would have caught WorldClim.
  * `use: facts` means figures checked against it: no redistribution right needed,
    but a URL a reader can follow is, or the citation is not a citation.
  * `use: blocked` is a source we looked at and may not use. Citing one fails the
    build and prints the reason, so the next person does not have to rediscover it.
A plain http URL stays legal as a citation: a one-off fact on one item does not earn
a registry entry.
"""
import json
import os
import re

USES = ('data', 'facts', 'software', 'blocked')
RETRIEVED = re.compile(r'^\d{4}-\d{2}$')


def _bilingual(v):
    return isinstance(v, dict) and bool(v.get('en')) and bool(v.get('hi'))


def _entries(d):
    """The real entries of a registry table: keys starting with _ are prose for readers."""
    return {k: v for k, v in (d or {}).items() if not k.startswith('_')}


class Registry:
    def __init__(self, data):
        self.licences = _entries(data.get('licences'))
        self.sources = _entries(data.get('sources'))
        self.base = list(data.get('base') or [])

    def validate(self):
        p = []
        for lid, lic in self.licences.items():
            if not _bilingual(lic.get('title')):
                p.append(f'licence {lid}: title needs en and hi')
            for flag in ('attribution', 'redistribute'):
                if not isinstance(lic.get(flag), bool):
                    p.append(f'licence {lid}: {flag} must be true or false')
            url = lic.get('url', '')
            if not isinstance(url, str):
                p.append(f'licence {lid}: url must be a string')
            elif lic.get('redistribute') and not url.startswith('http'):
                # A licence we rely on has to be one a reader can read for themselves.
                p.append(f'licence {lid}: a licence that permits redistribution needs its URL')
        for sid, s in self.sources.items():
            where = f'source {sid}'
            if not _bilingual(s.get('title')):
                p.append(f'{where}: title needs en and hi')
            if not _bilingual(s.get('publisher')):
                p.append(f'{where}: publisher needs en and hi')
            if not str(s.get('url', '')).startswith('http'):
                p.append(f'{where}: url must be an http URL')
            use = s.get('use')
            if use not in USES:
                p.append(f'{where}: use must be one of {USES}')
            if not RETRIEVED.match(str(s.get('retrieved', ''))):
                p.append(f'{where}: retrieved must be YYYY-MM')
            if s.get('note') is not None and not _bilingual(s.get('note')):
                p.append(f'{where}: note needs en and hi')
            if s.get('vintage') is not None and not isinstance(s['vintage'], str):
                p.append(f'{where}: vintage must be a string, e.g. "2011"')
            lid = s.get('licence')
            if lid is not None and lid not in self.licences:
                p.append(f'{where}: unknown licence {lid!r}')
            elif use in ('data', 'software'):
                if lid is None:
                    p.append(f'{where}: use {use!r} ships bytes derived from it, so it needs a licence')
                elif not self.licences[lid].get('redistribute'):
                    p.append(f'{where}: licence {lid} does not permit redistribution, so use cannot be {use!r}')
            elif use == 'blocked':
                if not _bilingual(s.get('note')):
                    p.append(f'{where}: a blocked source needs a note saying why, and the way out')
        for sid in self.base:
            if sid not in self.sources:
                p.append(f'base names a source that does not exist: {sid}')
            elif self.sources[sid].get('use') == 'blocked':
                p.append(f'base names a blocked source: {sid}')
        return p

    def check(self, cites, where):
        """Problems with one `sources` list. An empty list is the caller's business."""
        p = []
        for c in cites or []:
            if not isinstance(c, str) or not c:
                p.append(f'{where}: a source must be a registry id or an http URL')
            elif c.startswith('http'):
                continue
            elif c not in self.sources:
                p.append(f'{where}: no source {c!r} in content/sources.json')
            elif self.sources[c].get('use') == 'blocked':
                note = (self.sources[c].get('note') or {}).get('en', '')
                p.append(f'{where}: source {c!r} may not be used. {note}')
        return p

    def ids(self, cites):
        """The registry ids of a `sources` list, in order, dropping plain URLs."""
        return [c for c in cites or [] if isinstance(c, str) and not c.startswith('http')]

    def runtime(self, cited):
        """
        What ships: only the sources actually cited, in registry order, with the licences
        they name. A credits screen generated from this cannot list a dataset the atlas
        does not use, and cannot leave out one it does.
        """
        want = set(cited) | set(self.base)
        sources = {k: v for k, v in self.sources.items() if k in want and v.get('use') != 'blocked'}
        used = {s['licence'] for s in sources.values() if s.get('licence')}
        return {
            'base': [b for b in self.base if b in sources],
            'licences': {k: v for k, v in self.licences.items() if k in used},
            'sources': sources,
        }


def load(root=None, path=None):
    """Read the registry. Raises SystemExit with the problems if it does not hold up."""
    if path is None:
        root = root or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        path = os.path.join(root, 'content', 'sources.json')
    with open(path, encoding='utf-8') as f:
        reg = Registry(json.load(f))
    problems = reg.validate()
    if problems:
        print(f'{os.path.relpath(path)}: {len(problems)} problem(s)')
        for line in problems:
            print(f'  {line}')
        raise SystemExit(1)
    return reg
