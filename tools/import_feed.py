#!/usr/bin/env python3
"""Import wheel products from a store feed into catalog/products.json.

Reads a Shopify product feed (https://STORE/products.json, paged automatically, or a saved .json file)
and writes one catalog entry per wheel: name, size, offset, bolt pattern, finish, price, product URL and
the main product photo. Existing entries keep their manual overrides (face_ellipse, model3d, rot).

Usage:
  python3 tools/import_feed.py https://topperformance.qa --type Wheels --currency QAR
  python3 tools/import_feed.py saved-feed.json --base-url https://topperformance.qa
Then run:  python3 tools/build_catalog.py
"""
import argparse, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = ('face_ellipse', 'model3d', 'rot')

def fetch_feed(src):
    if not re.match(r'https?://', src): 
        with open(src, encoding='utf-8') as f: d = json.load(f)
        return d.get('products', d), None
    base = src.rstrip('/'); out, page = [], 1
    while True:
        req = urllib.request.Request('%s/products.json?limit=250&page=%d' % (base, page), headers={'User-Agent': 'vyro-catalog/1.0'})
        batch = json.load(urllib.request.urlopen(req, timeout=60)).get('products', [])
        out += batch
        if len(batch) < 250: return out, base
        page += 1

def parse_spec(text):
    """Pull diameter x width, offset and bolt pattern out of a product title, e.g. '22x10.5 6x139.7 BP ET32'."""
    t = text.replace('×', 'x'); out = {}
    m = re.search(r'\b(1[4-9]|2[0-8])\s*x\s*(\d{1,2}(?:\.\d{1,2})?)\b', t, re.I)
    if m: out['rim'] = int(m.group(1)); out['width'] = float(m.group(2))
    b = re.search(r'\b([4-8])\s*x\s*(\d{3}(?:\.\d{1,2})?)\b', t, re.I)
    if b: out['bolt'] = '%sx%s' % (b.group(1), b.group(2).rstrip('0').rstrip('.') if '.' in b.group(2) else b.group(2))
    e = re.search(r'\bET\s*(-?\d{1,3})\b|\b(-?\d{1,3})\s*mm\s*offset', t, re.I)
    if e: out['et'] = int(e.group(1) or e.group(2))
    return out

FINISHES = r'(gloss|matte|satin|chrome|polished|machined|milled|brushed|bronze|black|silver|grey|gray|gunmetal|white|gold|asphalt|diamond|tinted|textured|anthracite)'

def to_entry(p, base, old):
    title = p.get('title', ''); variants = p.get('variants') or [{}]; v = variants[0]
    spec = parse_spec(title + ' ' + (v.get('title') or '') + ' ' + ' '.join(p.get('tags') or []) if isinstance(p.get('tags'), list) else title + ' ' + str(p.get('tags', '')))
    images = p.get('images') or []
    if not images or 'rim' not in spec or 'bolt' not in spec: return None, 'missing ' + ('image' if not images else 'size or bolt pattern in title')
    name = re.split(r'\s+\d{2}\s*x\s*\d', title.replace('×', 'x'), maxsplit=1)[0].strip(' -') or title
    words = re.findall(FINISHES, title, re.I); finish = ' '.join(dict.fromkeys(w.capitalize() for w in words)) or 'Standard'
    parts = ['%d x %g' % (spec['rim'], spec['width'])] + (['ET%d' % spec['et']] if 'et' in spec else []) + [spec['bolt']]
    e = {'id': re.sub(r'[^a-z0-9]+', '_', p.get('handle', title).lower()).strip('_')[:60], 'sku': v.get('sku') or '', 'name': name,
         'spec': ' · '.join(parts), 'finish': finish, 'rim': spec['rim'], 'bolt': spec['bolt'], 'price': float(v.get('price') or 0),
         'url': '%s/products/%s' % (base or '', p.get('handle', '')), 'image': images[0].get('src', '')}
    prev = old.get(e['id'])
    if prev: e.update({k: prev[k] for k in KEEP if k in prev})
    return e, None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('source'); ap.add_argument('--base-url', default=None)
    ap.add_argument('--type', default='', help='only products whose product_type contains this text'); ap.add_argument('--out', default=os.path.join(ROOT, 'catalog', 'products.json'))
    ap.add_argument('--merge', action='store_true', help='keep existing entries that are not in the feed')
    a = ap.parse_args(); feed, base = fetch_feed(a.source); base = a.base_url or base
    cur = {'products': []}
    if os.path.exists(a.out):
        with open(a.out, encoding='utf-8') as f: cur = json.load(f)
    old = {p['id']: p for p in cur['products']}
    out, skipped = [], []
    for p in feed:
        if a.type and a.type.lower() not in (p.get('product_type') or '').lower(): continue
        e, why = to_entry(p, base, old)
        if e: out.append(e)
        else: skipped.append((p.get('handle'), why))
    if a.merge: ids = {e['id'] for e in out}; out += [p for p in cur['products'] if p['id'] not in ids]
    cur['products'] = out
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(cur, f, indent=1, ensure_ascii=False)
    print('%d wheels written to %s, %d skipped' % (len(out), os.path.relpath(a.out, ROOT), len(skipped)))
    for h, why in skipped[:20]: print('  skipped %s: %s' % (h, why))

if __name__ == '__main__': sys.exit(main())
