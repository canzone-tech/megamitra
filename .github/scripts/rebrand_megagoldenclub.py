from pathlib import Path
import json
import subprocess

tracked = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
replacements = [
    ('MegaMitra', 'MegaGoldenClub'),
    ('MEGAMITRA', 'MEGAGOLDENCLUB'),
    ('@megamitra/design-tokens', '@megagoldenclub/design-tokens'),
    ('megamitra-backend', 'megagoldenclub-backend'),
    ('megamitra-admin', 'megagoldenclub-admin'),
    ('megamitra-web', 'megagoldenclub-web'),
    ('megamitra-member', 'megagoldenclub-member'),
    ('megamitra_admin_access', 'megagoldenclub_admin_access'),
    ('megamitra_admin_refresh', 'megagoldenclub_admin_refresh'),
    ('megamitra_member_access', 'megagoldenclub_member_access'),
    ('megamitra_member_refresh', 'megagoldenclub_member_refresh'),
    ('megamitra-api', 'megagoldenclub-api'),
    ('megamitra-clients', 'megagoldenclub-clients'),
    ('megamitra:', 'megagoldenclub:'),
    ('megamitra.local', 'megagoldenclub.local'),
    ('megamitra-uat-headers', 'megagoldenclub-uat-headers'),
    ('megamitra-uat-body', 'megagoldenclub-uat-body'),
    ('megamitra-${randomUUID()}', 'megagoldenclub-${randomUUID()}'),
]

for raw in tracked:
    if (
        not raw
        or raw.startswith('backend/prisma/migrations/')
        or raw.startswith('.github/workflows/')
    ):
        continue
    path = Path(raw)
    try:
        text = path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        continue
    updated = text
    for old, new in replacements:
        updated = updated.replace(old, new)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

root_package = Path('package.json')
package = json.loads(root_package.read_text(encoding='utf-8'))
package['name'] = 'megagoldenclub'
root_package.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')

readme = Path('README.md')
readme.write_text(
    readme.read_text(encoding='utf-8').replace('megamitra/', 'megagoldenclub/'),
    encoding='utf-8',
)


def replace_between(path_str: str, start_marker: str, end_marker: str, replacement: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding='utf-8')
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker)) if start >= 0 else -1
    if start < 0 or end < 0:
        raise SystemExit(f'markers not found in {path_str}')
    path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')

replace_between(
    'backend/scripts/verify-local.sh',
    'echo "==> Checking MegaGoldenClub-only branding"\n',
    'echo "==> Lint"\n',
    'echo "==> Checking MegaGoldenClub branding contract"\n'
    'bash "${ROOT_DIR}/scripts/verify-branding.sh"\n\n',
)

replace_between(
    'scripts/verify-frontends.sh',
    "FORBIDDEN_REGEX='Fix''TradeZone|fix''tradezone|fix trade zone'\n",
    'echo "==> Verifying shared MegaGoldenClub design token contract"\n',
    'echo "==> Verifying MegaGoldenClub branding contract"\n'
    'bash "${ROOT_DIR}/scripts/verify-branding.sh"\n\n',
)
