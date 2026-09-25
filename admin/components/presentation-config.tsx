'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiJson } from '@/lib/client-api';
import styles from './presentation-config.module.css';

type Kind = 'THEME' | 'TEMPLATE' | 'CMS';
type Lifecycle = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
type Definition = { id: string; kind: Kind; surface: string; code: string; name: string; description: string | null; isDefault: boolean | number };
type Version = { id: string; definitionId: string; version: number; lifecycle: Lifecycle; publishedAt: string | null; retiredAt: string | null };

type Theme = {
  primary: string; secondary: string; accent: string; pageBackground: string; cardBackground: string;
  textColor: string; mutedTextColor: string; borderColor: string; gradientFrom: string; gradientVia: string;
  gradientTo: string; radius: 'SMALL' | 'MEDIUM' | 'LARGE'; density: 'COMPACT' | 'COMFORTABLE' | 'SPACIOUS';
  shadow: 'SUBTLE' | 'MEDIUM' | 'STRONG';
};
type Template = {
  sidebarVisible: boolean; sidebarPosition: 'LEFT' | 'RIGHT'; sidebarWidth: 'COMPACT' | 'DEFAULT' | 'WIDE';
  sidebarStyle: 'LIGHT' | 'DARK' | 'BRAND'; navigationStyle: 'FLAT' | 'PILL'; topbarVisible: boolean;
  topbarSticky: boolean; topbarStyle: 'LIGHT' | 'DARK' | 'BRAND' | 'GLASS'; topbarDensity: 'COMPACT' | 'COMFORTABLE';
  contentWidth: 'STANDARD' | 'WIDE' | 'FULL'; mobileNavigation: 'BOTTOM' | 'DRAWER';
};
type Cms = {
  dashboardEyebrow: string; dashboardSubtitle: string; binarySectionTitle: string; programSectionTitle: string;
  walletSectionTitle: string; rewardsSectionTitle: string;
};
type Content = Theme | Template | Cms;
type RuntimePart<T> = { source: 'PUBLISHED' | 'DEFAULT'; versionId: string | null; version: number | null; content: T };
type Runtime = { surface: string; theme: RuntimePart<Theme>; template: RuntimePart<Template>; cms: RuntimePart<Cms> };
type VersionDetail = Version & { content: Content };
type Editor = { definition: Definition; versions: Version[]; selected: Version | null; content: Content };

const fallbackTheme: Theme = {
  primary: '#0B5EC7', secondary: '#C90067', accent: '#F4B51C', pageBackground: '#F6F7FB', cardBackground: '#FFFFFF',
  textColor: '#17152B', mutedTextColor: '#74788B', borderColor: '#E7E9F1', gradientFrom: '#0B5EC7', gradientVia: '#C90067',
  gradientTo: '#F4B51C', radius: 'MEDIUM', density: 'COMFORTABLE', shadow: 'SUBTLE',
};
const fallbackTemplate: Template = {
  sidebarVisible: true, sidebarPosition: 'LEFT', sidebarWidth: 'DEFAULT', sidebarStyle: 'LIGHT', navigationStyle: 'PILL',
  topbarVisible: true, topbarSticky: true, topbarStyle: 'GLASS', topbarDensity: 'COMFORTABLE', contentWidth: 'WIDE', mobileNavigation: 'BOTTOM',
};
const fallbackCms: Cms = {
  dashboardEyebrow: 'My MegaGoldenClub',
  dashboardSubtitle: 'See your program progress, wallet, referrals, binary rewards, withdrawals and lucky draw activity.',
  binarySectionTitle: 'Binary performance', programSectionTitle: 'Program progress', walletSectionTitle: 'Wallet activity', rewardsSectionTitle: 'Rewards & referrals',
};
const tabs: Array<{ kind: Kind; label: string }> = [
  { kind: 'THEME', label: 'Colors & geometry' }, { kind: 'TEMPLATE', label: 'Sidebar & topbar' }, { kind: 'CMS', label: 'Portal copy' },
];
const colorFields: Array<{ key: keyof Pick<Theme, 'primary' | 'secondary' | 'accent' | 'pageBackground' | 'cardBackground' | 'textColor' | 'mutedTextColor' | 'borderColor' | 'gradientFrom' | 'gradientVia' | 'gradientTo'>; label: string }> = [
  { key: 'primary', label: 'Primary' }, { key: 'secondary', label: 'Secondary' }, { key: 'accent', label: 'Accent' },
  { key: 'pageBackground', label: 'Page background' }, { key: 'cardBackground', label: 'Card background' }, { key: 'textColor', label: 'Text' },
  { key: 'mutedTextColor', label: 'Muted text' }, { key: 'borderColor', label: 'Border' }, { key: 'gradientFrom', label: 'Gradient start' },
  { key: 'gradientVia', label: 'Gradient middle' }, { key: 'gradientTo', label: 'Gradient end' },
];

function versionLabel(version: Version) { return `v${version.version} · ${version.lifecycle}`; }

export function PresentationConfig() {
  const router = useRouter();
  const [tab, setTab] = useState<Kind>('THEME');
  const [editors, setEditors] = useState<Partial<Record<Kind, Editor>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [definitions, runtime] = await Promise.all([
        apiJson<Definition[]>('/api/backend/admin/presentation/definitions?surface=MEMBER'),
        apiJson<Runtime>('/api/backend/presentation/runtime?surface=MEMBER'),
      ]);
      const runtimeContent: Record<Kind, Content> = { THEME: runtime.theme.content, TEMPLATE: runtime.template.content, CMS: runtime.cms.content };
      const entries = await Promise.all(definitions.filter((row) => Boolean(row.isDefault)).map(async (definition) => {
        const versions = await apiJson<Version[]>(`/api/backend/admin/presentation/definitions/${definition.id}/versions`);
        const selected = versions.find((row) => row.lifecycle === 'DRAFT') ?? versions.find((row) => row.lifecycle === 'PUBLISHED') ?? versions[0] ?? null;
        const detail = selected ? await apiJson<VersionDetail>(`/api/backend/admin/presentation/versions/${selected.id}`) : null;
        return [definition.kind, { definition, versions, selected, content: detail?.content ?? runtimeContent[definition.kind] }] as const;
      }));
      setEditors(Object.fromEntries(entries) as Partial<Record<Kind, Editor>>);
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) { router.replace('/login'); return; }
      setError(reason instanceof ApiClientError ? reason.message : 'Unable to load presentation configuration');
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const theme = (editors.THEME?.content as Theme | undefined) ?? fallbackTheme;
  const template = (editors.TEMPLATE?.content as Template | undefined) ?? fallbackTemplate;
  const cms = (editors.CMS?.content as Cms | undefined) ?? fallbackCms;
  const active = editors[tab];
  const editable = active?.selected?.lifecycle === 'DRAFT';
  const previewStyle = useMemo(() => ({
    '--preview-primary': theme.primary, '--preview-secondary': theme.secondary, '--preview-accent': theme.accent,
    '--preview-page': theme.pageBackground, '--preview-card': theme.cardBackground, '--preview-text': theme.textColor,
    '--preview-muted': theme.mutedTextColor, '--preview-border': theme.borderColor, '--preview-gradient-from': theme.gradientFrom,
    '--preview-gradient-via': theme.gradientVia, '--preview-gradient-to': theme.gradientTo,
  }) as CSSProperties, [theme]);

  function replaceContent(kind: Kind, content: Content) {
    setEditors((current) => {
      const editor = current[kind];
      return editor ? { ...current, [kind]: { ...editor, content } } : current;
    });
  }
  function updateTheme(patch: Partial<Theme>) { replaceContent('THEME', { ...theme, ...patch }); }
  function updateTemplate(patch: Partial<Template>) { replaceContent('TEMPLATE', { ...template, ...patch }); }
  function updateCms(patch: Partial<Cms>) { replaceContent('CMS', { ...cms, ...patch }); }

  async function selectVersion(kind: Kind, versionId: string) {
    const editor = editors[kind]; if (!editor || !versionId) return;
    setBusy(true); setError('');
    try {
      const detail = await apiJson<VersionDetail>(`/api/backend/admin/presentation/versions/${versionId}`);
      setEditors((current) => ({ ...current, [kind]: { ...editor, selected: detail, content: detail.content } }));
    } catch (reason) { setError(reason instanceof ApiClientError ? reason.message : 'Unable to load version'); }
    finally { setBusy(false); }
  }

  async function createDraft(kind: Kind) {
    const editor = editors[kind]; if (!editor) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const source = editor.versions.find((row) => row.lifecycle === 'PUBLISHED') ?? editor.selected;
      const detail = await apiJson<VersionDetail>(`/api/backend/admin/presentation/definitions/${editor.definition.id}/versions`, {
        method: 'POST', body: JSON.stringify(source ? { copyFromVersionId: source.id } : {}),
      });
      setEditors((current) => ({
        ...current,
        [kind]: { ...editor, versions: [detail, ...editor.versions.filter((row) => row.id !== detail.id)], selected: detail, content: detail.content },
      }));
      setMessage(`${editor.definition.name} draft v${detail.version} created.`);
    } catch (reason) { setError(reason instanceof ApiClientError ? reason.message : 'Unable to create draft'); }
    finally { setBusy(false); }
  }

  async function saveDraft(kind: Kind, announce = true) {
    const editor = editors[kind]; if (!editor?.selected || editor.selected.lifecycle !== 'DRAFT') return;
    const detail = await apiJson<VersionDetail>(`/api/backend/admin/presentation/versions/${editor.selected.id}`, {
      method: 'PUT', body: JSON.stringify({ content: editor.content }),
    });
    setEditors((current) => ({ ...current, [kind]: { ...editor, selected: detail, content: detail.content } }));
    if (announce) setMessage(`${editor.definition.name} draft saved.`);
  }
  async function save(kind: Kind) {
    setBusy(true); setError(''); setMessage('');
    try { await saveDraft(kind); } catch (reason) { setError(reason instanceof ApiClientError ? reason.message : 'Unable to save draft'); }
    finally { setBusy(false); }
  }
  async function publish(kind: Kind) {
    const editor = editors[kind]; if (!editor?.selected || editor.selected.lifecycle !== 'DRAFT') return;
    setBusy(true); setError(''); setMessage('');
    try {
      await saveDraft(kind, false);
      await apiJson(`/api/backend/admin/presentation/versions/${editor.selected.id}/publish`, { method: 'POST' });
      setMessage(`${editor.definition.name} published. The member portal will now use this published version.`);
      await load();
    } catch (reason) { setError(reason instanceof ApiClientError ? reason.message : 'Unable to publish version'); }
    finally { setBusy(false); }
  }
  async function retire(kind: Kind) {
    const editor = editors[kind]; if (!editor?.selected || editor.selected.lifecycle !== 'PUBLISHED') return;
    setBusy(true); setError(''); setMessage('');
    try {
      await apiJson(`/api/backend/admin/presentation/versions/${editor.selected.id}/retire`, { method: 'POST' });
      setMessage(`${editor.definition.name} retired. Safe defaults apply until another version is published.`);
      await load();
    } catch (reason) { setError(reason instanceof ApiClientError ? reason.message : 'Unable to retire version'); }
    finally { setBusy(false); }
  }

  return <div className="mm-admin-shell">
    <header className="mm-topbar">
      <div className="mm-brand"><span className="mm-brand-mark">M</span><div><div>Mega<span className="mm-brand-accent">GoldenClub</span></div><div className="mm-brand-subtitle">Presentation studio</div></div></div>
      <nav className={styles.topActions}><Link className="mm-button secondary" href="/operations">Operations</Link><Link className="mm-button secondary" href="/business-plan">Business plan</Link></nav>
    </header>
    <main className="mm-page">
      <div className="mm-hero-row"><div><p className="mm-eyebrow">Portal appearance</p><h1 className="mm-title">Presentation studio</h1><p className="mm-subtitle">Manage member portal colors, layout and wording. Preview changes as drafts, then publish when they are ready.</p></div><button className="mm-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</button></div>
      {error ? <div className="mm-error" role="alert">{error}</div> : null}
      {message ? <div className="mm-success" role="status">{message}</div> : null}
      <div className="mm-tabs" role="tablist">{tabs.map(({ kind, label }) => <button className={`mm-tab ${tab === kind ? 'active' : ''}`} type="button" key={kind} onClick={() => setTab(kind)}>{label}</button>)}</div>
      <div className={styles.layout}>
        <section className="mm-card">
          <div className="mm-card-head"><div><h2>{active?.definition.name ?? tabs.find((item) => item.kind === tab)?.label}</h2><p className="mm-note">{active?.definition.description ?? 'Loading configuration definition…'}</p></div>{active?.selected ? <span className={`mm-chip ${active.selected.lifecycle === 'DRAFT' ? 'warning' : active.selected.lifecycle === 'PUBLISHED' ? 'success' : ''}`}>{versionLabel(active.selected)}</span> : <span className="mm-chip">Default design</span>}</div>
          <div className="mm-card-body">{active ? <>
            <div className={styles.versionRow}>
              <label className="mm-field"><span>Inspect version</span><select className="mm-input" value={active.selected?.id ?? ''} onChange={(event) => void selectVersion(tab, event.target.value)} disabled={busy || !active.versions.length}><option value="">Default design</option>{active.versions.map((version) => <option key={version.id} value={version.id}>{versionLabel(version)}</option>)}</select></label>
              <div className={styles.actions}>{!editable ? <button className="mm-button" type="button" disabled={busy} onClick={() => void createDraft(tab)}>Create draft</button> : <><button className="mm-button secondary" type="button" disabled={busy} onClick={() => void save(tab)}>Save draft</button><button className="mm-button" type="button" disabled={busy} onClick={() => void publish(tab)}>Publish</button></>}{active.selected?.lifecycle === 'PUBLISHED' ? <button className="mm-button secondary" type="button" disabled={busy} onClick={() => void retire(tab)}>Retire</button> : null}</div>
            </div>
            {tab === 'THEME' ? <ThemeFields value={theme} disabled={!editable || busy} onChange={updateTheme} /> : null}
            {tab === 'TEMPLATE' ? <TemplateFields value={template} disabled={!editable || busy} onChange={updateTemplate} /> : null}
            {tab === 'CMS' ? <CmsFields value={cms} disabled={!editable || busy} onChange={updateCms} /> : null}
            {!editable ? <p className="mm-note" style={{ marginTop: 16 }}>Published and retired versions are read-only. Create a draft to change these values.</p> : null}
          </> : <div className="mm-empty">Loading design settings…</div>}</div>
        </section>
        <aside className="mm-card">
          <div className="mm-card-head"><h2>Live member preview</h2><span className="mm-chip">Draft-safe</span></div>
          <div className="mm-card-body"><div className={styles.preview} style={previewStyle} data-sidebar-position={template.sidebarPosition} data-sidebar-width={template.sidebarWidth} data-sidebar-style={template.sidebarStyle} data-nav-style={template.navigationStyle} data-topbar-style={template.topbarStyle} data-topbar-density={template.topbarDensity} data-radius={theme.radius} data-density={theme.density} data-shadow={theme.shadow}>
            {template.sidebarVisible ? <div className={styles.previewSidebar}><strong>MegaGoldenClub</strong><span>Dashboard</span><span>Products</span><span>Withdrawals</span><span>KYC</span></div> : null}
            <div className={styles.previewMain}>{template.topbarVisible ? <div className={styles.previewTopbar}><strong>{cms.dashboardEyebrow}</strong><span>{template.topbarSticky ? 'Sticky' : 'Static'} topbar</span></div> : null}<div className={styles.previewBody}><div className={styles.previewHero}><small>{cms.dashboardEyebrow}</small><strong>Hello, Member</strong><span>{cms.dashboardSubtitle}</span></div><div className={styles.previewStats}><div><small>Wallet</small><strong>₹ —</strong></div><div><small>Pairs</small><strong>—</strong></div><div><small>Rewards</small><strong>—</strong></div></div><div className={styles.previewCards}><div><strong>{cms.binarySectionTitle}</strong><span>Authoritative member data</span></div><div><strong>{cms.programSectionTitle}</strong><span>Versioned program state</span></div></div></div></div>
          </div><p className="mm-note" style={{ marginTop: 12 }}>Preview uses presentation-only placeholders. Real member values continue to come from authoritative APIs.</p></div>
        </aside>
      </div>
    </main>
  </div>;
}

function ThemeFields({ value, disabled, onChange }: { value: Theme; disabled: boolean; onChange: (patch: Partial<Theme>) => void }) {
  return <div className={styles.fields}>{colorFields.map(({ key, label }) => <label className={styles.colorField} key={key}><span>{label}</span><div><input type="color" value={value[key]} disabled={disabled} onChange={(event) => onChange({ [key]: event.target.value.toUpperCase() })} /><input className="mm-input" value={value[key]} disabled={disabled} onChange={(event) => onChange({ [key]: event.target.value.toUpperCase() })} /></div></label>)}<Select label="Corner radius" value={value.radius} values={['SMALL', 'MEDIUM', 'LARGE']} disabled={disabled} onChange={(next) => onChange({ radius: next as Theme['radius'] })} /><Select label="Spacing density" value={value.density} values={['COMPACT', 'COMFORTABLE', 'SPACIOUS']} disabled={disabled} onChange={(next) => onChange({ density: next as Theme['density'] })} /><Select label="Shadow" value={value.shadow} values={['SUBTLE', 'MEDIUM', 'STRONG']} disabled={disabled} onChange={(next) => onChange({ shadow: next as Theme['shadow'] })} /></div>;
}
function TemplateFields({ value, disabled, onChange }: { value: Template; disabled: boolean; onChange: (patch: Partial<Template>) => void }) {
  return <div className={styles.fields}><Toggle label="Show sidebar" checked={value.sidebarVisible} disabled={disabled} onChange={(next) => onChange({ sidebarVisible: next })} /><Select label="Sidebar position" value={value.sidebarPosition} values={['LEFT', 'RIGHT']} disabled={disabled} onChange={(next) => onChange({ sidebarPosition: next as Template['sidebarPosition'] })} /><Select label="Sidebar width" value={value.sidebarWidth} values={['COMPACT', 'DEFAULT', 'WIDE']} disabled={disabled} onChange={(next) => onChange({ sidebarWidth: next as Template['sidebarWidth'] })} /><Select label="Sidebar style" value={value.sidebarStyle} values={['LIGHT', 'DARK', 'BRAND']} disabled={disabled} onChange={(next) => onChange({ sidebarStyle: next as Template['sidebarStyle'] })} /><Select label="Navigation style" value={value.navigationStyle} values={['FLAT', 'PILL']} disabled={disabled} onChange={(next) => onChange({ navigationStyle: next as Template['navigationStyle'] })} /><Toggle label="Show topbar" checked={value.topbarVisible} disabled={disabled} onChange={(next) => onChange({ topbarVisible: next })} /><Toggle label="Sticky topbar" checked={value.topbarSticky} disabled={disabled} onChange={(next) => onChange({ topbarSticky: next })} /><Select label="Topbar style" value={value.topbarStyle} values={['LIGHT', 'DARK', 'BRAND', 'GLASS']} disabled={disabled} onChange={(next) => onChange({ topbarStyle: next as Template['topbarStyle'] })} /><Select label="Topbar density" value={value.topbarDensity} values={['COMPACT', 'COMFORTABLE']} disabled={disabled} onChange={(next) => onChange({ topbarDensity: next as Template['topbarDensity'] })} /><Select label="Content width" value={value.contentWidth} values={['STANDARD', 'WIDE', 'FULL']} disabled={disabled} onChange={(next) => onChange({ contentWidth: next as Template['contentWidth'] })} /><Select label="Mobile navigation" value={value.mobileNavigation} values={['BOTTOM', 'DRAWER']} disabled={disabled} onChange={(next) => onChange({ mobileNavigation: next as Template['mobileNavigation'] })} /></div>;
}
function CmsFields({ value, disabled, onChange }: { value: Cms; disabled: boolean; onChange: (patch: Partial<Cms>) => void }) {
  return <div className={styles.fields}><TextField label="Dashboard eyebrow" value={value.dashboardEyebrow} maxLength={80} disabled={disabled} onChange={(next) => onChange({ dashboardEyebrow: next })} /><label className="mm-field"><span>Dashboard subtitle</span><textarea className="mm-input" rows={4} maxLength={320} disabled={disabled} value={value.dashboardSubtitle} onChange={(event) => onChange({ dashboardSubtitle: event.target.value })} /></label><TextField label="Binary section title" value={value.binarySectionTitle} maxLength={80} disabled={disabled} onChange={(next) => onChange({ binarySectionTitle: next })} /><TextField label="Program section title" value={value.programSectionTitle} maxLength={80} disabled={disabled} onChange={(next) => onChange({ programSectionTitle: next })} /><TextField label="Wallet section title" value={value.walletSectionTitle} maxLength={80} disabled={disabled} onChange={(next) => onChange({ walletSectionTitle: next })} /><TextField label="Rewards section title" value={value.rewardsSectionTitle} maxLength={80} disabled={disabled} onChange={(next) => onChange({ rewardsSectionTitle: next })} /></div>;
}
function Select({ label, value, values, disabled, onChange }: { label: string; value: string; values: readonly string[]; disabled: boolean; onChange: (next: string) => void }) { return <label className="mm-field"><span>{label}</span><select className="mm-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{values.map((option) => <option value={option} key={option}>{option.replaceAll('_', ' ')}</option>)}</select></label>; }
function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) { return <label className={styles.toggle}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
function TextField({ label, value, maxLength, disabled, onChange }: { label: string; value: string; maxLength: number; disabled: boolean; onChange: (next: string) => void }) { return <label className="mm-field"><span>{label}</span><input className="mm-input" value={value} maxLength={maxLength} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>; }
