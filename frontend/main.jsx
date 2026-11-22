import React from "react";
import * as ReactDOM from "react-dom/client";
import "./styles.css";

import { loadFamilyData, savePerson, listTrees } from './data';
import { readJson } from './http';
import PersonEditor from './PersonEditor';
import LocalMigration from './LocalMigration';
import FamilyDetails from './FamilyDetails';
import ChartViewport from './ChartViewport';
import Modal from './Modal';
import { PeopleDrawer, ToolsDrawer, useMobileLayout } from './WorkspacePanels';
import PersonRecords from './PersonRecords';
import DatabaseRecovery from './DatabaseRecovery';
import GedcomExchange from './GedcomExchange';
import BrowserGedcom from './BrowserGedcom';
import DuplicateReview from './DuplicateReview';
import AccessBoundary, { PrivacyEditor } from './Access';
import Sharing from './Sharing';
import navigationTools from '../src/domain/navigation';
const { resolveNavigationPerson } = navigationTools;
import graph from '../src/domain/graph';
import archiveTools from '../src/domain/archive';
const { fingerprint } = archiveTools;
import { loadLocalState, preserveRecovery } from './storage';
import ArchiveControls from './ArchiveControls';

import wheel from "../src/domain/wheel";
const { getSiblings, getChildren } = wheel;

import { IcTree } from "./icons";
import LineageWheel from "./LineageWheel";
import { PersonCard, Btn } from "./PersonCard";
import Legend from "./Legend";
import InfoPanel from "./InfoPanel";
import ErrorBoundary from "./ErrorBoundary";

const DEFAULT_ZOOM = 1.5;

// ─── APP ──────────────────────────────────────────────────────────────────────
function App({ source, trees, onSelectTree, accountControl }) {
  const canEdit = source.permissions?.canEdit !== false;
  const privateMode = ['private', 'shared'].includes(source.permissions?.mode);
  const [storage] = React.useState(() => {
    if (!privateMode) return localStorage;
    const memory = new Map();
    return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  });
  const [local] = React.useState(() => loadLocalState(storage, source));
  const [archive, setArchive] = React.useState(local.archive);
  const family = archive.family;
  const rootId = archive.rootId;
  const setFamily = (update) => setArchive((current) => ({
    ...current,
    family: typeof update === 'function' ? update(current.family) : update,
  }));
  const navigation = new URLSearchParams(location.search);
  const [aliases, setAliases] = React.useState(source.aliases || {});
  const [centerId, setCenterId] = React.useState(() => resolveNavigationPerson(family, source.aliases, navigation.get('person'), resolveNavigationPerson(family, source.aliases, local.centerId, rootId)));
  const [zoom, setZoom] = React.useState(DEFAULT_ZOOM);
  const [viewReset, setViewReset] = React.useState(0);
  const [panel, setPanel] = React.useState(null);
  const [toolGroup, setToolGroup] = React.useState(null);
  const mobile = useMobileLayout();
  const openTools = (group = null) => { setToolGroup(group); setPanel('tools'); };
  React.useEffect(() => {
    const search = event => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); setPanel('people');
      }
    };
    addEventListener('keydown', search); return () => removeEventListener('keydown', search);
  }, []);
  const [expanded, setExpanded] = React.useState(() => new Set());
  const [selectedPid, setSelectedPid] = React.useState(() => resolveNavigationPerson(family, source.aliases, navigation.get('selected')));
  const [sibAnchorPid, setSibAnchorPid] = React.useState(null);
  const [viewDirection, setViewDirection] = React.useState(navigation.get('view') === 'descendants' ? 'descendants' : 'ancestors');
  const [centerHistory, setCenterHistory] = React.useState([]);
  const [addCtx, setAddCtx] = React.useState(null);
  const [recordPersonId, setRecordPersonId] = React.useState(null);
  const [privacyPerson, setPrivacyPerson] = React.useState(null);
  const [recoveries, setRecoveries] = React.useState(local.recoveries);
  const [saveStatus, setSaveStatus] = React.useState('Saving in this browser…');
  const [baseFingerprint, setBaseFingerprint] = React.useState(local.baseFingerprint);
  const [revision, setRevision] = React.useState(source.revision || 0);
  const [serverStatus, setServerStatus] = React.useState(source.mode === 'database' ? 'Loaded from database' : '');
  const loadedSource = React.useRef({ rootId: source.rootId, family: source.family, ...(source.families && { families: source.families }) });

  function writeNavigation(id, direction, selected, push = false) {
    const url = new URL(location.href);
    if (source.mode === 'database' && !source.shared) url.searchParams.set('tree', source.treeId);
    url.searchParams.set('person', id);
    url.searchParams.set('view', direction);
    if (selected) url.searchParams.set('selected', selected);
    else url.searchParams.delete('selected');
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }

  React.useLayoutEffect(() => {
    writeNavigation(centerId, viewDirection, selectedPid);
  }, [centerId, viewDirection, selectedPid]);

  React.useLayoutEffect(() => {
    // Focus with the committed view. Deferring this to an animation frame can
    // steal focus after the user has already moved to another chart person.
    document.querySelector('[data-center-person-id]')?.focus({ preventScroll: true });
  }, [centerId, viewDirection]);

  React.useEffect(() => {
    function pop() {
      const params = new URLSearchParams(location.search);
      if ((params.get('tree') || '') !== (source.mode === 'database' && !source.shared ? source.treeId : '')) return;
      setCenterId(resolveNavigationPerson(family, aliases, params.get('person'), rootId));
      setViewDirection(params.get('view') === 'descendants' ? 'descendants' : 'ancestors');
      setSelectedPid(resolveNavigationPerson(family, aliases, params.get('selected')));
      setExpanded(new Set()); setSibAnchorPid(null); setCenterHistory([]);
    }
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, [family, aliases, rootId, source.treeId, source.mode]);

  function acceptServer(data) {
    const next = { rootId: data.rootId, family: data.family, ...(data.families && { families: data.families }) };
    loadedSource.current = next;
    setBaseFingerprint(fingerprint(next));
    setRevision(data.revision);
    setArchive(next);
    setAliases(data.aliases || {});
    setServerStatus('Saved in database');
    const resolve = (id, fallback = null) => resolveNavigationPerson(data.family, data.aliases, id, fallback);
    setCenterId(resolve(centerId, data.rootId));
    setSelectedPid(current => resolve(current));
    setSibAnchorPid(current => resolve(current));
    setExpanded(current => new Set([...current].map(id => resolve(id)).filter(Boolean)));
    setCenterHistory(current => current.map(entry => ({ ...entry, id: resolve(entry.id), selected: resolve(entry.selected) })).filter(entry => entry.id));
  }

  async function refreshTree() {
    const data = await loadFamilyData(source.treeId);
    setRecoveries(preserveRecovery(storage, local.key, JSON.stringify({ archive, centerId }), 'Before refreshing database'));
    acceptServer(data);
  }

  React.useEffect(() => {
    if (local.blocked) {
      setSaveStatus('Not saved — browser storage is unavailable');
      return;
    }
    try {
      storage.setItem(local.key, JSON.stringify({
        version: 3, treeId: source.treeId, baseFingerprint,
        archive, centerId,
      }));
      setSaveStatus(privateMode ? 'Private workspace — browser persistence disabled' : source.mode === 'database' ? 'Browser recovery saved' : 'Saved in this browser only');
    } catch {
      setSaveStatus('Not saved — browser storage is full or unavailable. Download a backup.');
    }
  }, [archive, centerId, local, source.treeId, source.mode, baseFingerprint]);

  function replaceArchive(nextArchive, reason) {
    if (local.blocked) throw new Error('Restore is blocked because browser storage is unavailable. Download your current archive first.');
    const raw = JSON.stringify({ archive, centerId });
    try {
      setRecoveries(preserveRecovery(storage, local.key, raw, reason));
      // Persist before replacing the visible tree. Storage failures leave the
      // current archive intact and the preview open for retry or cancellation.
      storage.setItem(local.key, JSON.stringify({
        version: 3, treeId: source.treeId, baseFingerprint,
        archive: nextArchive, centerId: nextArchive.rootId,
      }));
    } catch {
      throw new Error('Could not save a recovery copy and restored archive. Free browser storage or download a backup before trying again.');
    }
    setArchive(nextArchive);
    if (source.mode === 'database') setServerStatus('Local edits only — migrate before database editing');
    setCenterId(nextArchive.rootId);
    setExpanded(new Set());
    setSelectedPid(null);
    setSibAnchorPid(null);
    setCenterHistory([]);
  }

  const center = family[centerId];
  const selectedPerson = selectedPid ? family[selectedPid] : null;

  function lineageExpansionFor(personId) {
    return graph.lineagePath(centerId, personId, family, 'ancestors');
  }

  function descendantExpansionFor(personId) {
    return graph.lineagePath(centerId, personId, family, 'descendants');
  }

  function handleWedgeClick(personId, isSibling) {
    if (!personId) return;
    if (viewDirection === "descendants") {
      setSelectedPid(personId);
      setSibAnchorPid(null);
      setExpanded(descendantExpansionFor(personId));
      return;
    }
    if (isSibling) {
      setSelectedPid((prev) =>
        prev === personId ? sibAnchorPid : personId,
      );
    } else {
      if (sibAnchorPid === personId) {
        if (selectedPid === personId) {
          // Clicking the active anchor a second time hides siblings, matching the UI hint.
          setSibAnchorPid(null);
          setExpanded(lineageExpansionFor(personId));
        } else {
          // Sibling was dominant — re-click anchor rotates it back to center, fan stays open
          setSelectedPid(personId);
          setExpanded(lineageExpansionFor(personId));
        }
      } else {
        setSelectedPid(personId);
        setSibAnchorPid(personId);
        setExpanded(lineageExpansionFor(personId));
      }
    }
  }

  function rememberView() {
    setCenterHistory((prev) => [...prev, { id: centerId, direction: viewDirection, selected: selectedPid }]);
  }

  function handleRecenter(id, keepSelection = false) {
    if (id !== centerId) rememberView();
    writeNavigation(id, viewDirection, keepSelection ? id : null, id !== centerId);
    setCenterId(id);
    setExpanded(new Set());
    setSelectedPid(keepSelection ? id : null);
    setSibAnchorPid(null);
  }

  function handleHistoryBack() {
    if (centerHistory.length === 0) return;
    const previous = centerHistory.at(-1);
    setCenterHistory((prev) => prev.slice(0, -1));
    setCenterId(previous.id);
    setViewDirection(previous.direction);
    setExpanded(new Set());
    setSelectedPid(previous.selected);
    setSibAnchorPid(null);
  }

  function handleHistoryJump(index) {
    const target = centerHistory[index];
    if (!target) return;
    setCenterHistory((prev) => prev.slice(0, index));
    setCenterId(target.id);
    setViewDirection(target.direction);
    setExpanded(new Set());
    setSelectedPid(target.selected);
    setSibAnchorPid(null);
  }

  function handleSelectRelative(id) {
    if (!id || !family[id]) return;
    setSelectedPid(id);
    const path = graph.lineagePath(centerId, id, family, viewDirection);
    if (path.size > 0) {
      setExpanded(path);
      setSibAnchorPid(viewDirection === 'ancestors' && id !== centerId ? id : null);
    } else {
      setSibAnchorPid(null);
    }
  }

  function handleToggleDirection() {
    const direction = viewDirection === 'ancestors' ? 'descendants' : 'ancestors';
    const id = selectedPid || centerId;
    rememberView();
    writeNavigation(id, direction, selectedPid, true);
    setCenterId(id);
    setViewDirection(direction);
    setExpanded(new Set());
    setSibAnchorPid(null);
  }

  function handleSpouseClick(id) {
    setSelectedPid(id);
    setSibAnchorPid(null);
    setExpanded(new Set());
  }

  function handleReset() {
    setZoom(DEFAULT_ZOOM);
    setViewReset(value => value + 1);
    setCenterId(rootId);
    setExpanded(new Set());
    setSelectedPid(null);
    setSibAnchorPid(null);
    setViewDirection("ancestors");
    setCenterHistory([]);
  }

  async function handleAddPerson(newId, formData, ctx) {
    const { personId, type } = ctx;
    if (source.mode === 'database') {
      if (fingerprint(archive) !== baseFingerprint) {
        throw new Error('This archive has local-only edits. Migrate them before editing the database, or discard them after downloading a backup.');
      }
      setServerStatus('Saving to database…');
      try {
        const next = await savePerson(source.treeId, type === 'edit' ? personId : null, {
          requestId: ctx.requestId, expectedRevision: revision, person: formData,
          type, targetId: personId, existingPersonId: ctx.existingPersonId || undefined,
          coParentId: ctx.coParentId || undefined, pedigree: ctx.pedigree, preferred: ctx.preferred,
          parentSlot: type === 'child' ? family[personId]?.gender === 'F' ? 'mother' : family[personId]?.gender === 'M' ? 'father' : undefined : undefined,
        });
        acceptServer(next);
      } catch (error) { setServerStatus('Save failed — form preserved'); throw error; }
      return;
    }
    if (type === 'edit') {
      setFamily((prev) => ({ ...prev, [personId]: { ...prev[personId], ...formData, name: formData.name.trim() } }));
      return;
    }

    const newPerson = {
      id: newId,
      name: formData.name.trim(),
      gender: formData.gender,
      ...(formData.birth && { birth: formData.birth }),
      ...(formData.death && { death: formData.death }),
      ...(formData.birthplace && { birthplace: formData.birthplace }),
      ...(formData.occupation && { occupation: formData.occupation }),
      ...(formData.bio && { bio: formData.bio }),
    };

    setFamily((prev) => {
      const next = { ...prev };

      if (type === "sibling") {
        const currentTarget = prev[personId];
        const knownSiblings = getSiblings(personId, prev);
        const relatedIds = [
          ...new Set([personId, ...knownSiblings.map((p) => p.id)]),
        ];
        newPerson.motherId = currentTarget?.motherId;
        newPerson.fatherId = currentTarget?.fatherId;
        newPerson.siblingIds = relatedIds;
        next[newId] = newPerson;
        for (const relatedId of relatedIds) {
          const related = next[relatedId];
          if (!related) continue;
          next[relatedId] = {
            ...related,
            siblingIds: [
              ...new Set([...(related.siblingIds || []), newId]),
            ],
          };
        }
      } else if (type === "spouse") {
        newPerson.spouseIds = [personId];
        next[newId] = newPerson;
        const existing = new Set(next[personId]?.spouseIds || []);
        if (next[personId]?.spouseId) existing.add(next[personId].spouseId);
        existing.add(newId);
        next[personId] = {
          ...next[personId],
          spouseIds: [...existing],
          spouseId: undefined,
        };
      } else if (type === "child") {
        // Place the selected person by gender; if they have exactly one
        // spouse, link that spouse as the other parent. Anyone without a
        // binary gender takes whichever slot the spouse leaves open.
        const coParent = ctx.coParentId ? prev[ctx.coParentId] : null;
        const parents = [prev[personId], coParent].filter(Boolean);
        const flexible = [];
        for (const parent of parents) {
          if (parent.gender === "M" && !newPerson.fatherId) {
            newPerson.fatherId = parent.id;
          } else if (parent.gender === "F" && !newPerson.motherId) {
            newPerson.motherId = parent.id;
          } else {
            flexible.push(parent.id);
          }
        }
        for (const parentId of flexible) {
          if (!newPerson.motherId) newPerson.motherId = parentId;
          else if (!newPerson.fatherId) newPerson.fatherId = parentId;
        }
        next[newId] = newPerson;
      } else if (
        type === "mother" ||
        (type === "parent" && formData.gender === "F")
      ) {
        next[newId] = newPerson;
        next[personId] = { ...next[personId], motherId: newId };
      } else if (
        type === "father" ||
        (type === "parent" && formData.gender === "M")
      ) {
        next[newId] = newPerson;
        next[personId] = { ...next[personId], fatherId: newId };
      } else {
        // generic parent — use gender to determine
        next[newId] = newPerson;
        if (formData.gender === "F")
          next[personId] = { ...next[personId], motherId: newId };
        else next[personId] = { ...next[personId], fatherId: newId };
      }
      return next;
    });

    if (type === "child") {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(personId);
        return next;
      });
    }
  }

  const stats = React.useMemo(
    () => ({
      total: Object.values(family).filter(person => !person.placeholder).length,
      expanded: expanded.size,
    }),
    [family, expanded],
  );

  const draft = source.mode === 'database' && fingerprint(archive) !== baseFingerprint;
  const status = saveStatus.startsWith('Not saved') ? saveStatus : serverStatus.includes('failed') ? serverStatus : draft ? 'Browser draft — review before editing' : serverStatus.startsWith('Saving') ? serverStatus : source.mode === 'database' ? 'Saved in database' : 'Saved in this browser only';
  const acceptToolServer = data => { acceptServer(data); setPanel(null); };
  const groups = [
    ...(source.mode === 'database' ? [{ id: 'exchange', title: 'Import and export', description: 'GEDCOM files and original import sources', content: <>
      {source.privacyNotice && <p className="notice">{source.privacyNotice}</p>}
      <GedcomExchange privateMode={privateMode} treeId={source.treeId} shareToken={source.shareToken} readOnly={!canEdit} draft={draft} onImported={onSelectTree} onSaved={acceptToolServer} />
    </> }] : [{ id: 'exchange', title: 'Import and export', description: 'Import or export GEDCOM 7.0 (.ged) files in this browser', content: (
      <BrowserGedcom archive={archive} onImportArchive={(next, reason) => { replaceArchive(next, reason); setPanel(null); }} />
    ) }]),
    ...(canEdit && source.mode === 'database' ? [{ id: 'backups', title: 'Backups and history', description: 'Full-tree backup, restore, and edit history', content: <DatabaseRecovery treeId={source.treeId} blocked={draft} onSaved={acceptToolServer} onRestored={onSelectTree} /> },
      { id: 'research', title: 'Research', description: 'Add a person or review possible duplicates', content: <>
        <button onClick={() => { setPanel(null); setAddCtx({ type: 'person' }); }}>Add person</button>
        <DuplicateReview treeId={source.treeId} archive={archive} selectedId={selectedPid} blocked={draft} onSaved={acceptToolServer} />
      </> }] : []),
    ...(source.permissions?.canManage ? [{ id: 'sharing', title: 'Sharing', description: 'Members, invitations, and read-only links', content: <Sharing treeId={source.treeId} /> }] : []),
    ...(canEdit ? [{ id: 'browser', title: 'Browser drafts', description: source.mode === 'database' ? 'Local drafts, migration, and projection recovery' : 'Start a new tree, or back up and restore your browser archive', content: <>
      <ArchiveControls archive={archive} source={source} saveStatus={status} notice={local.notice} recoveries={recoveries}
        onStartNew={source.mode !== 'database' ? (next => { replaceArchive(next, 'Before starting new family tree'); setPanel(null); }) : undefined}
        onRestore={next => { replaceArchive(next, 'Before backup restore'); setPanel(null); }}
        onDiscard={() => { replaceArchive(loadedSource.current, 'Before discarding local edits'); setPanel(null); }} />
      {source.mode === 'database' && draft && <LocalMigration treeId={source.treeId} archive={archive}
        onBeforeApply={() => setRecoveries(preserveRecovery(storage, local.key, JSON.stringify({ archive, centerId }), 'Before database migration'))}
        onApplied={acceptToolServer} />}
    </> }] : []),
  ];
  const details = <>
    {selectedPerson ? <>
      <PersonCard person={selectedPerson} isCenter={selectedPid === centerId} family={family} canEdit={canEdit} database={source.mode === 'database'}
        onRecenter={id => { handleRecenter(id); if (mobile) setPanel(null); }}
        onSelectPerson={handleSelectRelative}
        onClose={() => { setSelectedPid(null); setSibAnchorPid(null); setPanel(null); }}
        onAddPerson={(personId, type) => { if (mobile) setPanel(null); setAddCtx({ personId, type }); }} />
      {canEdit && <Btn full onClick={() => { if (mobile) setPanel(null); setAddCtx({ type: 'edit', personId: selectedPid }); }}>Edit person</Btn>}
      {source.mode === 'database' && canEdit && <Btn full disabled={draft} onClick={() => { if (mobile) setPanel(null); setRecordPersonId(selectedPid); }}>Records and evidence</Btn>}
      {canEdit && privateMode && <Btn full disabled={draft} onClick={() => { if (mobile) setPanel(null); setPrivacyPerson(selectedPid); }}>Privacy and sharing</Btn>}
      <FamilyDetails personId={selectedPid} archive={archive} onSelectPerson={handleSelectRelative} />
    </> : <InfoPanel canEdit={canEdit} />}
    {canEdit && source.mode === 'database' && <button className="add-independent" onClick={() => { if (mobile) setPanel(null); setAddCtx({ type: 'person' }); }}>Add person</button>}
    <details className="legend-disclosure"><summary>Chart legend</summary><Legend viewDirection={viewDirection} /></details>
  </>;

  return <div className="workspace">
    <header className="workspace-header glass">
      <div className="header-inner">
        <div className="workspace-brand"><IcTree /><h1 className="fd">Rootline</h1></div>
        {source.mode === 'database' && !source.shared ? <label className="workspace-tree"><span className="sr-only">Tree</span>
          <select aria-label="Tree" value={source.treeId} onChange={event => onSelectTree(event.target.value)}>
            {(trees.length ? trees : [{ id: source.treeId, name: source.treeName }]).map(tree => <option key={tree.id} value={tree.id}>{tree.name}</option>)}
          </select></label> : <span className="workspace-tree-name">{source.treeName}</span>}
        <span className="workspace-count">{stats.total} people</span>
        <nav className="workspace-actions" aria-label="Workspace">
          <button onClick={() => setPanel('people')} title="Find a person (/)" aria-keyshortcuts="/">Find person <kbd aria-hidden="true">/</kbd></button>
          <button onClick={() => openTools()}>Tree tools</button>
          {accountControl}
        </nav>
      </div>
      <div className="workspace-status" aria-label="Archive status">
        <span className="source-badge">{source.shared || !canEdit ? 'Read only' : privateMode ? 'Private workspace' : source.mode === 'database' ? 'Local database' : 'Browser archive'}</span>
        <span role="status" className={draft || saveStatus.startsWith('Not saved') || status.includes('failed') ? 'notice' : ''}>{status}</span>
        {draft && <button onClick={() => openTools('browser')}>Review draft</button>}
        {saveStatus.startsWith('Not saved') && <button onClick={() => openTools('browser')}>Back up now</button>}
        {!draft && local.notice && <button onClick={() => openTools('browser')}>Review recovery</button>}
        {source.privacyNotice && <button onClick={() => openTools('exchange')}>Visibility details</button>}
      </div>
    </header>
    {local.notice && <div className="workspace-warning" role="status"><span>{local.notice}</span></div>}
    <main className="app-layout">
      <section className="chart-section">
        <div className="chart-heading">
          <div><h2 className="fd">{viewDirection === 'ancestors' ? 'The Lineage of ' : 'Descendants of '}<span>{center?.name}</span></h2>
            <p>Click a person for details · Double-click to center</p></div>
          <div className="view-switch" role="group" aria-label="View direction">
            <button aria-label="Show ancestors" aria-pressed={viewDirection === 'ancestors'} onClick={() => { if (viewDirection !== 'ancestors') handleToggleDirection(); }}>Ancestors</button>
            <button aria-label="Show descendants" aria-pressed={viewDirection === 'descendants'} onClick={() => { if (viewDirection !== 'descendants') handleToggleDirection(); }}>Descendants</button>
          </div>
        </div>
        <div className="chart-card glass">
          <ChartViewport zoom={zoom} onZoom={setZoom} centerKey={`${centerId}:${viewDirection}:${viewReset}`} canGoBack={centerHistory.length > 0} onBack={handleHistoryBack} onReset={handleReset}>
            <LineageWheel centerId={centerId} family={family} expanded={expanded} selectedPid={selectedPid} sibAnchorPid={sibAnchorPid}
              viewDirection={viewDirection} canEdit={canEdit} onWedgeClick={handleWedgeClick} onWedgeDoubleClick={handleRecenter}
              onEmptySlotClick={(childId, slot) => setAddCtx({ personId: childId, type: slot })}
              onCenterClick={() => { setSelectedPid(centerId); setSibAnchorPid(null); }} onSpouseClick={handleSpouseClick} />
          </ChartViewport>
          {center && (viewDirection === 'ancestors' ? !center.motherId && !center.fatherId : getChildren(centerId, family).length === 0) &&
            <p className="chart-empty" role="status">No {viewDirection} recorded for {center.name}. {canEdit ? 'Select this person to add relatives.' : 'Only approved relationships are shown.'}</p>}
        </div>
        {centerHistory.length > 0 && (
          <nav className="chart-breadcrumbs" aria-label="Lineage trail">
            <ol>
              {centerHistory.map((entry, idx) => {
                const next = centerHistory[idx + 1] || { id: centerId, direction: viewDirection };
                const sameAsNext = entry.id === next.id;
                const label = family[entry.id]?.name || 'Previous';
                return (
                  <li key={`${entry.id}:${entry.direction}:${idx}`}>
                    <button type="button" onClick={() => handleHistoryJump(idx)}>
                      {sameAsNext ? `${label} (${entry.direction})` : label}
                    </button>
                    <span className="breadcrumb-sep" aria-hidden="true">›</span>
                  </li>
                );
              })}
              <li aria-current="page">
                <span>
                  {centerHistory.at(-1)?.id === centerId
                    ? `${center?.name || 'Current'} (${viewDirection})`
                    : center?.name || 'Current'}
                </span>
              </li>
            </ol>
          </nav>
        )}
        <div className="chart-footnote"><span>{stats.expanded} branches expanded</span><span>Zoom in, then drag to pan · Center wheel to return</span></div>
        {mobile && <div className="mobile-person-summary"><span>{selectedPerson ? selectedPerson.name : 'Explore your family'}<small>{selectedPerson ? 'Selected individual' : 'Select a person in the wheel'}</small></span><button onClick={() => setPanel('details')}>Person details</button></div>}
      </section>
      {!mobile && <aside className="app-sidebar" aria-label="Person details">{details}</aside>}
    </main>
    <footer className="workspace-footer">Rootline · {source.treeName}</footer>
    {panel === 'people' && <PeopleDrawer family={family} onSelect={id => handleRecenter(id, true)} onClose={() => setPanel(null)} />}
    {panel === 'tools' && <ToolsDrawer groups={groups} initialGroup={toolGroup} onClose={() => setPanel(null)} />}
    {panel === 'details' && mobile && <Modal title="Person details" variant="drawer" onClose={() => setPanel(null)}><div className="person-details-sheet">{details}</div></Modal>}
    {privacyPerson && <PrivacyEditor treeId={source.treeId} person={family[privacyPerson]} revision={revision} onSaved={acceptServer} onClose={() => setPrivacyPerson(null)} />}
    {recordPersonId && <PersonRecords treeId={source.treeId} personId={recordPersonId} personName={family[recordPersonId]?.name || 'Person'} onSaved={acceptServer} onClose={() => setRecordPersonId(null)} />}
    {addCtx && <PersonEditor context={addCtx} family={family} onSubmit={handleAddPerson} database={source.mode === 'database'} onRefresh={refreshTree} onClose={() => setAddCtx(null)} />}
  </div>;
}

function Bootstrap({ session, shareToken, onSessionChange, accountControl }) {
  const [source, setSource] = React.useState(null);
  const [accessNotice, setAccessNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [treeId, setTreeId] = React.useState(new URLSearchParams(location.search).get('tree') || '');
  const [trees, setTrees] = React.useState([]);
  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError('');
    async function load() {
      if (shareToken) {
        const response = await fetch(`/api/share/${encodeURIComponent(shareToken)}`, { signal: controller.signal });
        const data = await readJson(response, 'Shared archive is unavailable');
        archiveTools.validateArchive(data);
        return { ...data, mode: 'database', shareToken };
      }
      return loadFamilyData(treeId, { signal: controller.signal });
    }
    load().then((data) => {
      if (!active) return;
      setSource(data);
      if (data.mode === 'database' && !shareToken) listTrees().then((items) => { if (active) setTrees(items); }).catch(() => {});
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      if (active) setError(error.message);
    });
    return () => { active = false; controller.abort(); };
  }, [attempt, treeId, shareToken]);
  React.useEffect(() => {
    if (session.mode !== 'private' || !source) return;
    let active = true;
    async function checkAccess() {
      try {
        const url = shareToken ? `/api/share/${encodeURIComponent(shareToken)}` : `/api/trees/${source.treeId}/family-data`;
        const response = await fetch(url);
        if (!active) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            setSource(null); setError('Access is unavailable. Sign in again or ask the owner for access.');
            if (response.status === 401) onSessionChange();
          } else setAccessNotice('Tree access could not be checked. Unsaved forms are retained in memory while reconnecting.');
          return;
        }
        const next = await readJson(response, 'Tree access check failed');
        if (!active) return;
        setAccessNotice('');
        // Replace the entire mounted workspace when access changes. Never keep
        // editor state or forms alive behind a newly filtered viewer tree.
        if (next.permissions?.role !== source.permissions?.role || (source.redacted && next.revision !== source.revision)) {
          setSource({ ...next, mode: 'database', ...(shareToken && { shareToken }) });
          setAttempt(value => value + 1);
        }
      } catch { if (active) setAccessNotice('Tree access could not be checked. Unsaved forms are retained in memory while reconnecting.'); }
    }
    const timer = setInterval(checkAccess, 5000);
    addEventListener('focus', checkAccess);
    return () => { active = false; clearInterval(timer); removeEventListener('focus', checkAccess); };
  }, [session.mode, source, shareToken, onSessionChange]);
  React.useEffect(() => {
    function pop() {
      if (shareToken) return;
      const id = new URLSearchParams(location.search).get('tree') || '';
      if (id !== treeId && id !== source?.treeId) { setSource(null); setTreeId(id); }
    }
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, [treeId, source?.treeId, shareToken]);
  if (source) return <>{accessNotice && <p role="status" className="account-bar">{accessNotice}</p>}<App key={`${source.treeId}:${source.permissions?.role || 'local'}:${source.redacted ? source.revision : ''}`} source={source} trees={trees} accountControl={accountControl} onSelectTree={(id) => {
    const url = new URL(location.href);
    url.searchParams.set('tree', id);
    for (const key of ['person', 'view', 'selected']) url.searchParams.delete(key);
    history.pushState(null, '', url);
    setSource(null); setTreeId(id);
  }} /></>;
  return <main className="load-state">
    <h1>Rootline</h1>
    {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Retry loading archive</button></> : <p role="status">Loading family archive…</p>}
    {!shareToken && error && document.querySelector('meta[name="lineage-mode"]')?.content === 'database' && <>
      <DatabaseRecovery onRestored={(id) => { setTreeId(id); setAttempt(value => value + 1); }} />
      <GedcomExchange privateMode={session.mode === 'private'} onImported={(id) => { setTreeId(id); setAttempt(value => value + 1); }} />
    </>}
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AccessBoundary>{context => <Bootstrap {...context} />}</AccessBoundary>
  </ErrorBoundary>,
);
