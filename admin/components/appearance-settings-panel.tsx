'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import styles from './presentation-config.module.css';

type Kind = 'THEME' | 'TEMPLATE' | 'CMS';
type Lifecycle = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
type Definition = { id: string; kind: Kind; name: string; description: string | null; isDefault: boolean | number };
type Version = { id: string; version: number; lifecycle: Lifecycle };
type Theme = {
  primary: string; secondary: string; accent: string; pageBackground: string; cardBackground: string;
  textColor: string; mutedTextColor: string; borderColor: string; gradientFrom: string; gradientVia: string; gradientTo: string;
  radius: 'SMALL' | 'MEDIUM' | 'LARGE'; density: 'COMPACT' | 'COMFORTABLE' | 'SPACIOUS'; shadow: 'SUBTLE' | 'MEDIUM' | 'STRONG';
};
type Template = {
  sidebarVisible: boolean; sidebarPosition: 'LEFT' | 'RIGHT'; sidebarWidth: 'COMPACT' | 'DEFAULT' | 'WIDE'; sidebarStyle: 'LIGHT' | 'DARK' | 'BRAND';
  navigationStyle: 'FLAT' | 'PILL'; topbarVisible: boolean; topbarSticky: boolean; topbarStyle: 'LIGHT' | 'DARK' | 'BRAND' | 'GLASS';
  topbarDensity: 'COMPACT' | 'COMFORTABLE'; contentWidth: 'STANDARD' | 'WIDE' | 'FULL'; mobileNavigation: 'BOTTOM' | 'DRAWER';
};
type Cms = { dashboardEyebrow: string; dashboardSubtitle: string; binarySectionTitle: string; programSectionTitle: string; walletSectionTitle: string; rewardsSectionTitle: string };
type Content = Theme | Template | Cms;
type Runtime = { theme: { content: Theme }; template: { content: Template }; cms: { content: Cms } };
type Detail = Version & { content: Content };
type Editor = { definition: Definition; versions: Version[]; selected: Version | null; content: Content };

const fallbackTheme: Theme = {
  primary: '#0B5EC7', secondary: '#C90067', accent: '#F4B51C', pageBackground: '#F6F7FB', cardBackground: '#FFFFFF', textColor: '#17152B',
  mutedTextColor: '#74788B', borderColor: '#E7E9F1', gradientFrom: '#0B5EC7', gradientVia: '#C90067', gradientTo: '#F4B51C', radius: 'MEDIUM', density: 'COMFORTABLE', shadow: 'SUBTLE',
};
const fallbackTemplate: Template = {
  sidebarVisible: true, sidebarPosition: 'LEFT', sidebarWidth: 'DEFAULT', sidebarStyle: 'LIGHT', navigationStyle: 'PILL', topbarVisible: true,
  topbarSticky: true, topbarStyle: 'GLASS', topbarDensity: 'COMFORTABLE', contentWidth: 'WIDE', mobileNavigation: 'BOTTOM',
};
const fallbackCms: Cms = {
  dashboardEyebrow: 'My MegaGoldenClub', dashboardSubtitle: 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.',
  binarySectionTitle: 'Binary performance', programSectionTitle: 'Program progress', walletSectionTitle: 'Wallet activity', rewardsSectionTitle: 'Rewards & referrals',
};
const tabs: Array<{ kind: Kind; label: string }> = [
  { kind: 'THEME', label: 'Colors & geometry' }, { kind: 'TEMPLATE', label: 'Sidebar & topbar' }, { kind: 'CMS', label: 'Portal copy' },
];
const colors: Array<{ key: keyof Theme; label: string }> = [
  { key: 'primary', label: 'Primary' }, { key: 'secondary', label: 'Secondary' }, { key: 'accent', label: 'Accent' }, { key: 'pageBackground', label: 'Page background' },
  { key: 'cardBackground', label: 'Card background' }, { key: 'textColor', label: 'Text' }, { key: 'mutedTextColor', label: 'Muted text' }, { key: 'borderColor', label: 'Border' },
  { key: 'gradientFrom', label: 'Gradient start' }, { key: 'gradientVia', label: 'Gradient middle' }, { key: 'gradientTo', label: 'Gradient end' },
];

function versionLabel(version: Version) { return `v${version.version} · ${version.lifecycle}`; }

export function AppearanceSettingsPanel() {
  const router = useRouter();
  const [tab, setTab] = useState<Kind>('THEME');
  const [editors, setEditors] = useState<Partial<Record<Kind, Editor>>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [definitions, runtime] = await Promise.all([
        apiJson<Definition[]>('/api/backend/admin/presentation/definitions?surface=MEMBER'),
        apiJson<Runtime>('/api/backend/presentation/runtime?surface=MEMBER'),
      ]);
      const fallback: Record<Kind, Content> = { THEME: runtime.theme.content, TEMPLATE: runtime.template.content, CMS: runtime.cms.content };
      const entries = await Promise.all(definitions.filter((item) => Boolean(item.isDefault)).map(async (definition) => {
        const versions = await apiJson<Version[]>(`/api/backend/admin/presentation/definitions/${definition.id}/versions`);
        const selected = versions.find((item) => item.lifecycle === 'DRAFT') ?? versions.find((item) => item.lifecycle === 'PUBLISHED') ?? versions[0] ?? null;
        const detail = selected ? await apiJson<Detail>(`/api/backend/admin/presentation/versions/${selected.id}`) : null;
        return [definition.kind, { definition, versions, selected, content: detail?.content ?? fallback[definition.kind] }] as const;
      }));
      setEditors(Object.fromEntries(entries) as Partial<Record<Kind, Editor>>);
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) { router.replace('/login'); return; }
      setError(reason instanceof Error ? reason.message : 'Unable to load appearance settings');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const theme = (editors.THEME?.content as Theme | undefined) ?? fallbackTheme;
  const template = (editors.TEMPLATE?.content as Template | undefined) ?? fallbackTemplate;
  const cms = (editors.CMS?.content as Cms | undefined) ?? fallbackCms;
  const active = editors[tab];
  const editable = active?.selected?.lifecycle === 'DRAFT';

  function replace(kind: Kind, content: Content) {
    setEditors((current) => {
      const editor = current[kind];
      return editor ? { ...current, [kind]: { ...editor, content } } : current;
    });
  }
  function updateTheme(patch: Partial<Theme>) { replace('THEME', { ...theme, ...patch }); }
  function updateTemplate(patch: Partial<Template>) { replace('TEMPLATE', { ...template, ...patch }); }
  function updateCms(patch: Partial<Cms>) { replace('CMS', { ...cms, ...patch }); }

  async function selectVersion(versionId: string) {
    if (!active || !versionId) return;
    setBusy(true); setError('');
    try {
      const detail = await apiJson<Detail>(`/api/backend/admin/presentation/versions/${versionId}`);
      setEditors((current) => ({ ...current, [tab]: { ...active, selected: detail, content: detail.content } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load version'); }
    finally { setBusy(false); }
  }

  async function createDraft() {
    if (!active) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const source = active.versions.find((item) => item.lifecycle === 'PUBLISHED') ?? active.selected;
      const detail = await apiJson<Detail>(`/api/backend/admin/presentation/definitions/${active.definition.id}/versions`, {
        method: 'POST', body: JSON.stringify(source ? { copyFromVersionId: source.id } : {}),
      });
      setEditors((current) => ({ ...current, [tab]: { ...active, versions: [detail, ...active.versions.filter((item) => item.id !== detail.id)], selected: detail, content: detail.content } }));
      setNotice(`${active.definition.name} draft created.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create draft'); }
    finally { setBusy(false); }
  }

  async function persist(announce = true) {
    if (!active?.selected || active.selected.lifecycle !== 'DRAFT') return;
    const detail = await apiJson<Detail>(`/api/backend/admin/presentation/versions/${active.selected.id}`, {
      method: 'PUT', body: JSON.stringify({ content: active.content }),
    });
    setEditors((current) => ({ ...current, [tab]: { ...active, selected: detail, content: detail.content } }));
    if (announce) setNotice(`${active.definition.name} draft saved.`);
  }

  async function save() {
    setBusy(true); setError(''); setNotice('');
    try { await persist(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save draft'); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!active?.selected || active.selected.lifecycle !== 'DRAFT') return;
    setBusy(true); setError(''); setNotice('');
    try {
      await persist(false);
      await apiJson(`/api/backend/admin/presentation/versions/${active.selected.id}/publish`, { method: 'POST' });
      setNotice(`${active.definition.name} published to the member portal.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish appearance'); }
    finally { setBusy(false); }
  }

  async function retire() {
    if (!active?.selected || active.selected.lifecycle !== 'PUBLISHED') return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiJson(`/api/backend/admin/presentation/versions/${active.selected.id}/retire`, { method: 'POST' });
      setNotice(`${active.definition.name} retired.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to retire appearance version'); }
    finally { setBusy(false); }
  }

  return <div className="mm-grid">
    {error ? <div className="mm-error" role="alert">{error}</div> : null}
    {notice ? <div className="mm-success" role="status">{notice}</div> : null}
    <div className="mm-tabs" role="tablist">{tabs.map((item) => <button key={item.kind} type="button" className={`mm-tab ${tab === item.kind ? 'active' : ''}`} onClick={() => setTab(item.kind)}>{item.label}</button>)}</div>
    <section className="mm-card">
      <div className="mm-card-head"><div><h2>{active?.definition.name ?? 'Member portal appearance'}</h2><p className="mm-note">{active?.definition.description ?? 'Versioned member portal colors, layout and wording.'}</p></div>{active?.selected ? <span className={`mm-chip ${active.selected.lifecycle === 'DRAFT' ? 'warning' : active.selected.lifecycle === 'PUBLISHED' ? 'success' : ''}`}>{versionLabel(active.selected)}</span> : <span className="mm-chip">DEFAULT</span>}</div>
      <div className="mm-card-body">
        {loading && !active ? <div className="mm-empty">Loading appearance configuration…</div> : active ? <>
          <div className={styles.versionRow}>
            <label className="mm-field"><span>Version</span><select className="mm-input" value={active.selected?.id ?? ''} onChange={(event) => void selectVersion(event.target.value)} disabled={busy || !active.versions.length}><option value="">Default design</option>{active.versions.map((item) => <option key={item.id} value={item.id}>{versionLabel(item)}</option>)}</select></label>
            <div className={styles.actions}>{!editable ? <button className="mm-button" type="button" onClick={() => void createDraft()} disabled={busy}>CREATE DRAFT</button> : <><button className="mm-button secondary" type="button" onClick={() => void save()} disabled={busy}>SAVE DRAFT</button><button className="mm-button" type="button" onClick={() => void publish()} disabled={busy}>PUBLISH</button></>}{active.selected?.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" type="button" onClick={() => void retire()} disabled={busy}>RETIRE</button> : null}</div>
          </div>
          {tab === 'THEME' ? <ThemeFields value={theme} disabled={!editable || busy} onChange={updateTheme} /> : null}
          {tab === 'TEMPLATE' ? <TemplateFields value={template} disabled={!editable || busy} onChange={updateTemplate} /> : null}
          {tab === 'CMS' ? <CmsFields value={cms} disabled={!editable || busy} onChange={updateCms} /> : null}
          {!editable ? <p className="mm-note" style={{ marginTop: 18 }}>Published/retired versions are read-only. Create a draft before editing.</p> : null}
        </> : <div className="mm-empty">No default appearance definition is configured.</div>}
      </div>
    </section>
  </div>;
}

function ThemeFields({ value, disabled, onChange }: { value: Theme; disabled: boolean; onChange: (patch: Partial<Theme>) => void }) {
  return <div className="mm-form"><div className={styles.fields}>{colors.map(({ key, label }) => {
    const current = String(value[key]);
    return <label className={styles.colorField} key={key}>{label}<div><input type="color" value={current} disabled={disabled} onChange={(event) => onChange({ [key]: event.target.value } as Partial<Theme>)} /><input value={current} disabled={disabled} pattern="#[0-9A-Fa-f]{6}" onChange={(event) => onChange({ [key]: event.target.value } as Partial<Theme>)} /></div></label>;
  })}</div><div className="mm-grid two"><label>Corner radius<select value={value.radius} disabled={disabled} onChange={(event) => onChange({ radius: event.target.value as Theme['radius'] })}><option>SMALL</option><option>MEDIUM</option><option>LARGE</option></select></label><label>Density<select value={value.density} disabled={disabled} onChange={(event) => onChange({ density: event.target.value as Theme['density'] })}><option>COMPACT</option><option>COMFORTABLE</option><option>SPACIOUS</option></select></label><label>Card shadow<select value={value.shadow} disabled={disabled} onChange={(event) => onChange({ shadow: event.target.value as Theme['shadow'] })}><option>SUBTLE</option><option>MEDIUM</option><option>STRONG</option></select></label></div></div>;
}

function TemplateFields({ value, disabled, onChange }: { value: Template; disabled: boolean; onChange: (patch: Partial<Template>) => void }) {
  return <div className="mm-form"><div className={styles.fields}><Toggle label="Show sidebar" checked={value.sidebarVisible} disabled={disabled} onChange={(checked) => onChange({ sidebarVisible: checked })} /><Toggle label="Show topbar" checked={value.topbarVisible} disabled={disabled} onChange={(checked) => onChange({ topbarVisible: checked })} /><Toggle label="Sticky topbar" checked={value.topbarSticky} disabled={disabled} onChange={(checked) => onChange({ topbarSticky: checked })} /><Select label="Sidebar position" value={value.sidebarPosition} disabled={disabled} options={['LEFT','RIGHT']} onChange={(next) => onChange({ sidebarPosition: next as Template['sidebarPosition'] })} /><Select label="Sidebar width" value={value.sidebarWidth} disabled={disabled} options={['COMPACT','DEFAULT','WIDE']} onChange={(next) => onChange({ sidebarWidth: next as Template['sidebarWidth'] })} /><Select label="Sidebar style" value={value.sidebarStyle} disabled={disabled} options={['LIGHT','DARK','BRAND']} onChange={(next) => onChange({ sidebarStyle: next as Template['sidebarStyle'] })} /><Select label="Navigation style" value={value.navigationStyle} disabled={disabled} options={['FLAT','PILL']} onChange={(next) => onChange({ navigationStyle: next as Template['navigationStyle'] })} /><Select label="Topbar style" value={value.topbarStyle} disabled={disabled} options={['LIGHT','DARK','BRAND','GLASS']} onChange={(next) => onChange({ topbarStyle: next as Template['topbarStyle'] })} /><Select label="Topbar density" value={value.topbarDensity} disabled={disabled} options={['COMPACT','COMFORTABLE']} onChange={(next) => onChange({ topbarDensity: next as Template['topbarDensity'] })} /><Select label="Content width" value={value.contentWidth} disabled={disabled} options={['STANDARD','WIDE','FULL']} onChange={(next) => onChange({ contentWidth: next as Template['contentWidth'] })} /><Select label="Mobile navigation" value={value.mobileNavigation} disabled={disabled} options={['BOTTOM','DRAWER']} onChange={(next) => onChange({ mobileNavigation: next as Template['mobileNavigation'] })} /></div></div>;
}

function CmsFields({ value, disabled, onChange }: { value: Cms; disabled: boolean; onChange: (patch: Partial<Cms>) => void }) {
  const fields: Array<{ key: keyof Cms; label: string; area?: boolean }> = [
    { key: 'dashboardEyebrow', label: 'Dashboard eyebrow' }, { key: 'dashboardSubtitle', label: 'Dashboard subtitle', area: true }, { key: 'binarySectionTitle', label: 'Binary section title' },
    { key: 'programSectionTitle', label: 'Program section title' }, { key: 'walletSectionTitle', label: 'Wallet section title' }, { key: 'rewardsSectionTitle', label: 'Rewards section title' },
  ];
  return <div className="mm-form"><div className={styles.fields}>{fields.map((field) => <label key={field.key}>{field.label}{field.area ? <textarea rows={4} value={value[field.key]} disabled={disabled} onChange={(event) => onChange({ [field.key]: event.target.value })} /> : <input value={value[field.key]} disabled={disabled} onChange={(event) => onChange({ [field.key]: event.target.value })} />}</label>)}</div></div>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.toggle}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function Select({ label, value, disabled, options, onChange }: { label: string; value: string; disabled: boolean; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}</select></label>;
}
