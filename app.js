/* Blind Test 0.3.1 — uses Spotify's React, no external runtime or account. */
function BlindTestAnswerInput({ fieldName, label, placeholder, value, onChange, disabled, difficulty, index }) {
  const R = Spicetify.React, h = R.createElement;
  const [focused, setFocused] = R.useState(false);
  const [dismissed, setDismissed] = R.useState(false);
  const [activeIndex, setActiveIndex] = R.useState(-1);
  const inputRef = R.useRef(null), listRef = R.useRef(null);
  const easy = difficulty === 'easy';
  const matches = R.useMemo(() => easy && !disabled ? BTCore.suggestions(index, fieldName, value) : [], [easy, disabled, index, fieldName, value]);
  const searching = easy && !disabled && focused && !dismissed && !!BTCore.normalize(value);
  const open = searching && matches.length > 0;
  const listId = `bt-suggestions-${fieldName}`;
  R.useEffect(() => { if (open && activeIndex >= 0) listRef.current?.children[activeIndex]?.scrollIntoView({ block:'nearest' }); }, [open, activeIndex]);
  function choose(suggestion) {
    onChange(suggestion); setDismissed(true); setActiveIndex(-1); inputRef.current?.focus();
  }
  function keyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    if (easy && matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); setDismissed(false);
      setActiveIndex(current => event.key === 'ArrowDown' ? (current + 1) % matches.length : (current <= 0 ? matches.length - 1 : current - 1));
    } else if (open && event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault(); choose(matches[activeIndex]);
    } else if (searching && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setDismissed(true); setActiveIndex(-1);
    }
  }
  return h('div',{className:'bt-completion'},
    h('label',{className:'bt-field'},h('span',null,label),h('input',{
      ref:inputRef,name:fieldName,value,placeholder,autoComplete:'off',spellCheck:false,maxLength:250,disabled,
      role:easy?'combobox':undefined,'aria-autocomplete':easy?'list':undefined,'aria-haspopup':easy?'listbox':undefined,
      'aria-expanded':easy?open:undefined,'aria-controls':open?listId:undefined,
      'aria-activedescendant':open && activeIndex>=0?`${listId}-${activeIndex}`:undefined,
      onFocus:()=>{setFocused(true);setDismissed(false);},onBlur:()=>{setFocused(false);setActiveIndex(-1);},onKeyDown:keyDown,
      onChange:event=>{onChange(event.target.value);setDismissed(false);setActiveIndex(-1);}
    })),
    open?h('ul',{ref:listRef,id:listId,className:'bt-suggestions',role:'listbox','aria-label':fieldName==='title'?'Suggestions de titres':'Suggestions d’artistes'},
      matches.map((suggestion,i)=>h('li',{key:suggestion,id:`${listId}-${i}`,role:'option','aria-selected':activeIndex===i,
        onMouseDown:event=>event.preventDefault(),onMouseEnter:()=>setActiveIndex(i),onClick:()=>choose(suggestion)},suggestion))):null,
    searching && !matches.length?h('span',{className:'bt-hint',role:'status'},'Aucune suggestion. Tu peux saisir ta réponse librement.'):null);
}

function BlindTestApp() {
  const R = Spicetify.React, h = R.createElement, core = globalThis.BTCore;
  const store = R.useMemo(() => globalThis.BTStore.create(), []);
  const initial = R.useMemo(() => store.getSettings(), [store]);
  const adapter = R.useMemo(() => globalThis.BTPreviewAdapter || globalThis.BTSpotify.create(), []);
  const [settings, setSettings] = R.useState(initial);
  const [screen, setScreen] = R.useState('setup');
  const [game, setGame] = R.useState(null);
  const [answers, setAnswers] = R.useState({ title: '', artist: '' });
  const [error, setError] = R.useState('');
  const [notice, setNotice] = R.useState('');
  const [feedback, setFeedback] = R.useState('');
  const [playing, setPlaying] = R.useState(false);
  const [elapsed, setElapsed] = R.useState(0);
  const [heardStep, setHeardStep] = R.useState(-1);
  const [loadingLabel, setLoadingLabel] = R.useState('Chargement…');
  const [record, setRecord] = R.useState(null);
  const alive = R.useRef(true), busy = R.useRef(false), operation = R.useRef(0);
  const gameRef = R.useRef(null), heardRef = R.useRef(-1), screenRef = R.useRef(screen);
  const stageRef = R.useRef(null), catalogRef = R.useRef(null), savedId = R.useRef(null);
  screenRef.current = screen;
  const preview = !!globalThis.BTPreviewAdapter;
  const active = screen === 'game' || screen === 'results';
  const track = game?.deck[game.index], round = game?.round;
  const seconds = game ? game.mode === 'challenge' ? core.STEPS[round.step] : game.seconds : 1;
  const durationMs = track ? Math.min(seconds * 1000, Math.max(1000, track.durationMs - game.starts[game.index] - 500)) : 1000;
  const score = game ? game.history.reduce((sum,row) => sum + core.totalRound(row.round), 0) + (round.revealed ? 0 : core.totalRound(round)) : 0;
  const change = (key, value) => setSettings(current => ({ ...current, [key]: value }));
  function useLikedSongs() { change('playlists', 'spotify:collection:tracks'); setError(''); setNotice('Titres likés sélectionnés. Choisis tes règles puis lance la partie.'); }
  function commit(value) { gameRef.current = value; setGame(value); }
  function markHeard(value) { heardRef.current = value; setHeardStep(value); }
  function stop() { operation.current++; busy.current = false; adapter.stop(); setPlaying(false); }
  function clearRoundUI() { markHeard(-1); setElapsed(0); setAnswers({title:'',artist:''}); setFeedback(''); setError(''); }
  function leave() { stop(); setScreen('setup'); setError(''); setNotice(''); setFeedback(''); }

  R.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current++; adapter.dispose(); };
  }, [adapter]);
  R.useEffect(() => { store.saveSettings(settings); }, [settings, store]);
  R.useEffect(() => {
    function consumeLaunch() {
      if (screenRef.current !== 'setup') return;
      let pending = globalThis.__blindTestPendingV2;
      try { if (!pending) pending = JSON.parse(localStorage.getItem('blind-test:launch:v2') || 'null'); localStorage.removeItem('blind-test:launch:v2'); } catch (_) { /* Ignore malformed pending launch. */ }
      globalThis.__blindTestPendingV2 = null;
      if (!pending || !Number.isFinite(pending.at) || Math.abs(Date.now()-pending.at) > 600000 || !Array.isArray(pending.uris) || !pending.uris.length || pending.uris.length > 5) return;
      try { const uris = pending.uris.map(core.parsePlaylist); setSettings(current => ({...current, playlists:uris.join('\n')})); setNotice('Sélection prête. Choisis tes règles puis lance la partie.'); } catch (_) { /* Only supported music sources are accepted. */ }
    }
    consumeLaunch(); globalThis.addEventListener('blind-test:launch',consumeLaunch);
    return () => globalThis.removeEventListener('blind-test:launch',consumeLaunch);
  }, [screen]);
  R.useEffect(() => {
    const dialog = stageRef.current;
    if (active && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [active]);
  R.useEffect(() => { stageRef.current?.querySelector('[data-autofocus]')?.focus(); }, [screen, game?.id, game?.index, round?.step, round?.revealed]);

  function startSession(catalog, rules, replay = false, preservedStarts = null) {
    const maxSeconds = rules.mode === 'challenge' ? 16 : rules.seconds;
    const eligible = catalog.tracks.filter(t => rules.mode !== 'challenge' || t.durationMs >= 17000);
    const deck = core.makeSmartDeck(eligible, rules.rounds, {recentUris:replay?[]:store.getRecentUris()});
    if (!deck.length) throw new Error(rules.mode === 'challenge' ? 'Aucun morceau assez long pour les 5 paliers. Essaie le mode Entraînement.' : 'Aucun morceau jouable dans cette sélection.');
    stop();
    const starts = deck.map(t => preservedStarts?.get(t.uri) ?? core.chooseStart(t, maxSeconds, rules.passage));
    const difficulty = rules.difficulty === 'easy' ? 'easy' : 'hard';
    const suggestionIndex = difficulty === 'easy' ? core.buildSuggestionIndex((replay ? catalogRef.current : catalog)?.tracks || catalog.tracks) : null;
    const next = { id:`${Date.now()}-${Math.random()}`,deck,starts,passageStarts:starts.map(start=>[start]),index:0,round:core.createRound(),history:[],mode:rules.mode,passage:rules.passage,seconds:rules.seconds,difficulty,suggestionIndex,
      playlistUris:catalog.uris,source:catalog.name,replay,recordKey:store.recordKey({playlistUris:catalog.uris,...rules,rounds:deck.length}) };
    commit(next); clearRoundUI(); setRecord(null); setScreen('game');
    setNotice(replay ? 'Révision des erreurs · entraînement hors record.' : deck.length < rules.rounds ? `${deck.length} manche${deck.length>1?'s':''} disponible${deck.length>1?'s':''} dans cette sélection.` : '');
  }

  async function load(event) {
    event?.preventDefault(); if (busy.current) return;
    let uris;
    try { const lines=settings.playlists.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); if (!lines.length || lines.length>5) throw new Error('Ajoute entre 1 et 5 sources (playlists ou albums), une par ligne.'); uris=[...new Set(lines.map(core.parsePlaylist))]; }
    catch (cause) { setError(cause.message); return; }
    busy.current=true; const ticket=++operation.current;
    setError('');setNotice('');setScreen('loading');
    try {
      const tracks=[],names=[];
      for (let i=0;i<uris.length;i++) {
        setLoadingLabel(`Chargement de la sélection ${i+1} / ${uris.length}…`);
        const data=await adapter.loadPlaylist(uris[i]);
        if (!alive.current || ticket!==operation.current) return;
        tracks.push(...data.tracks);names.push(data.name || 'Ma sélection');
      }
      const catalog={tracks,uris,name:names.join(' + ')};catalogRef.current=catalog;
      startSession(catalog,settings);
    } catch(cause) { if (alive.current && ticket===operation.current) {setError(cause.message || 'Chargement impossible.');setScreen('setup');} }
    finally { if(ticket===operation.current) busy.current=false; }
  }

  async function listen() {
    const current=gameRef.current;
    if(busy.current || !current || current.round.revealed) return;
    busy.current=true;const ticket=++operation.current;
    setPlaying(true);setError('');setElapsed(0);
    const step=current.round.step;
    try {
      await adapter.playExcerpt(current.deck[current.index],{startMs:current.starts[current.index],durationMs,
        onProgress:progress=>{if(alive.current && ticket===operation.current){setElapsed(progress.elapsedMs/1000);if(progress.elapsedMs>100)markHeard(step);}}});
      if(alive.current && ticket===operation.current)markHeard(step);
    } catch(cause) {if(alive.current && ticket===operation.current && cause.name!=='AbortError')setError(cause.message || 'Lecture impossible. Réessaie cet extrait.');}
    finally {if(alive.current && ticket===operation.current){busy.current=false;setPlaying(false);}}
  }

  function withNewPassage(current) {
    const starts=[...current.starts],passageStarts=[...current.passageStarts];
    const previous=passageStarts[current.index];
    // Reserve the longest tier so every subsequent excerpt fits safely.
    starts[current.index]=core.chooseNextStart(current.deck[current.index],current.mode==='challenge'?16:current.seconds,previous);
    passageStarts[current.index]=[...previous,starts[current.index]];
    return {...current,starts,passageStarts};
  }

  function applyRound(nextRound) {
    const current=gameRef.current;
    if(!current || current.round===nextRound)return;
    stop();
    const history=[...current.history];
    if(nextRound.revealed)history[current.index]={track:current.deck[current.index],startMs:current.starts[current.index],round:nextRound};
    const next=current.passage==='random' && nextRound.step!==current.round.step && !nextRound.revealed?withNewPassage(current):current;
    commit({...next,round:nextRound,history});
    if(nextRound.step!==current.round.step){markHeard(-1);setElapsed(0);}
    setError('');
  }

  function submit(event) {
    event.preventDefault(); const current=gameRef.current;
    if(!current || current.round.revealed || heardRef.current!==current.round.step)return;
    const updated=core.submitRound(current.deck[current.index],current.round,answers,{mode:current.mode});
    const gained=core.totalRound(updated)-core.totalRound(current.round);
    applyRound(updated);
    setFeedback(updated.revealed?'':gained>0?`+${gained} point${gained>1?'s':''} acquis. Continue pour la réponse restante.`:current.mode==='challenge'?`Pas encore. ${current.passage==='random'?'Un autre passage t’attend':'Passe à l’extrait'} : ${core.STEPS[updated.step]} secondes.`:'Pas encore. Tu peux réécouter ou révéler la réponse.');
  }
  function extend() { const current=gameRef.current;if(!current || current.round.revealed)return;applyRound(core.advanceRound(current.round));setFeedback(''); }
  function anotherPassage() {
    const current=gameRef.current;
    if(!current || current.round.revealed || current.passage!=='random' || current.mode!=='training')return;
    stop();commit(withNewPassage(current));markHeard(-1);setElapsed(0);setFeedback('');setError('');
  }
  function reveal() { const current=gameRef.current;if(!current || current.round.revealed)return;applyRound(core.revealRound(current.round));setFeedback(''); }
  function correct(field) { const current=gameRef.current;if(!current)return;applyRound(core.correctRound(current.round,field,{mode:current.mode})); }
  function finish() {
    const current=gameRef.current;
    if(!current || !current.round.revealed)return;
    stop();
    if(current.index+1<current.deck.length){commit({...current,index:current.index+1,round:core.createRound()});clearRoundUI();return;}
    if(savedId.current!==current.id){
      const rows=current.history;
      const assisted=current.replay || rows.some(row=>row.round.title.manual || row.round.artist.manual);
      const result=store.saveResult(current.recordKey,{score:rows.reduce((sum,row)=>sum+core.totalRound(row.round),0),maxScore:core.maxPoints(current.mode)*rows.length,rounds:rows.length,
        firstTry:rows.filter(row=>row.round.title.found && row.round.artist.found && row.round.title.step===0 && row.round.artist.step===0).length,
        artists:rows.filter(row=>row.round.artist.found).length,uris:rows.map(row=>row.track.uri),assisted});
      setRecord({...result,assisted});savedId.current=current.id;
    }
    setScreen('results');
  }
  function newSelection() {try{startSession(catalogRef.current,settings);}catch(cause){setError(cause.message);}}
  function retryErrors() {
    const rows=game.history.filter(row=>!row.round.title.found || !row.round.artist.found);
    if(!rows.length)return;
    const previousStarts=new Map(rows.map(row=>[row.track.uri,row.startMs]));
    startSession({tracks:rows.map(row=>row.track),uris:game.playlistUris,name:game.source},{rounds:rows.length,mode:'training',difficulty:game.difficulty,passage:game.passage,seconds:game.mode==='challenge'?16:game.seconds},true,previousStarts);
  }

  const btn=(label,onClick,className='bt-button bt-secondary',extra={})=>h('button',{type:'button',className,onClick,...extra},label);
  const field=(label,element)=>h('label',{className:'bt-field'},h('span',null,label),element);
  const header=h('header',{className:'bt-header'},h('div',{className:'bt-brand'},h('span',{className:'bt-logo','aria-hidden':true},'◉'),'BLIND TEST'),h('span',{className:'bt-badge'},preview?'APERÇU · AUDIO SIMULÉ':'VERSION TEST · 0.3.1'));
  const errorView=error?h('div',{className:'bt-error',role:'alert'},error):null;
  const stageProps={ref:stageRef,className:'bt-root bt-stage','aria-label':'Partie de Blind Test',onCancel:event=>{event.preventDefault();leave();}};

  if(screen==='setup' || screen==='loading')return h('main',{className:'bt-root'},header,
    h('section',{className:'bt-hero'},h('div',null,h('p',{className:'bt-eyebrow'},'TA MUSIQUE. EN QUELQUES NOTES.'),h('h1',null,'La bonne',h('br'),h('em',null,'oreille.')),h('p',{className:'bt-intro'},'Un artiste à reconnaître. Un titre à retrouver. Combien de secondes te faudra-t-il ?')),
      h('div',{className:'bt-record','aria-hidden':true},h('div',{className:'bt-record-label'},'SIDE B',h('strong',null,'?'),'1 → 16 s'))),
    h('div',{className:'bt-setup-grid'},h('form',{className:'bt-card',onSubmit:load},
      h('div',{className:'bt-section-title'},h('span',{className:'bt-number'},'01'),h('h2',null,'Compose ta partie')),
      h('fieldset',{className:'bt-mode-picker',disabled:screen==='loading'},h('legend',null,'Mode de jeu'),
        ['challenge','training'].map(value=>h('label',{key:value,className:settings.mode===value?'bt-mode selected':'bt-mode'},h('input',{type:'radio',name:'game-mode',value,checked:settings.mode===value,onChange:()=>change('mode',value)}),h('span',null,h('strong',null,value==='challenge'?'Défi progressif':'Entraînement'),h('small',null,value==='challenge'?'1, 2, 4, 8, 16 secondes':'À ton rythme, durée au choix'))))),
      h('fieldset',{className:'bt-mode-picker',disabled:screen==='loading'},h('legend',null,'Difficulté'),
        ['easy','hard'].map(value=>h('label',{key:value,className:settings.difficulty===value?'bt-mode selected':'bt-mode'},h('input',{type:'radio',name:'game-difficulty',value,checked:settings.difficulty===value,onChange:()=>change('difficulty',value)}),h('span',null,h('strong',null,value==='easy'?'Facile':'Difficile'),h('small',null,value==='easy'?'Suggestions pendant la saisie':'Réponses sans aide'))))),
      h('div',{className:'bt-source-shortcuts'},btn('♥ Mes titres likés',useLikedSongs,'bt-button bt-secondary',{disabled:screen==='loading'})),
      field('Playlists ou albums Spotify · un lien par ligne',h('textarea',{name:'playlists',rows:3,value:settings.playlists,placeholder:'https://open.spotify.com/playlist/… ou /album/…',autoComplete:'off',spellCheck:false,required:true,disabled:screen==='loading',onChange:e=>change('playlists',e.target.value)})),
      h('p',{className:'bt-hint'},'Jusqu’à 5 sources. Utilise tes titres likés ou colle tes liens. Clic droit sur une playlist ou un album → Jouer au blind test.'),
      h('div',{className:'bt-options'},field('Manches',h('select',{value:settings.rounds,disabled:screen==='loading',onChange:e=>change('rounds',Number(e.target.value))},[5,10,15,20].map(n=>h('option',{key:n,value:n},`${n} morceaux`)))),
        field('Passage',h('select',{value:settings.passage,disabled:screen==='loading',onChange:e=>change('passage',e.target.value)},h('option',{value:'intro'},'Début du morceau'),h('option',{value:'random'},'Au hasard'))),
        settings.mode==='training'?field('Durée de l’extrait',h('select',{value:settings.seconds,disabled:screen==='loading',onChange:e=>change('seconds',Number(e.target.value))},[5,10,15,20].map(n=>h('option',{key:n,value:n},`${n} secondes`)))):null),
      notice?h('p',{className:'bt-hint',role:'status'},notice):null,errorView,h('button',{className:'bt-button bt-primary bt-wide',type:'submit',disabled:screen==='loading'},screen==='loading'?loadingLabel:'C’est parti  →'),screen==='loading'?btn('Annuler',leave,'bt-button bt-text'):null),
      h('aside',{className:'bt-card bt-rules'},h('p',{className:'bt-eyebrow'},settings.mode==='challenge'?'LE DÉFI':'L’ENTRAÎNEMENT'),h('h2',null,settings.mode==='challenge'?'Une seconde.':'Écoute. Devine.',h('br'),settings.mode==='challenge'?'Peut-être assez.':'À ton rythme.'),
        settings.mode==='challenge'?h('div',{className:'bt-preview-steps'},core.STEPS.map((n,i)=>h('div',{key:n},h('strong',null,`${n} s`),h('span',null,`${core.STEP_POINTS[i]} pts`)))):null,
        h('ol',null,h('li',null,h('strong',null,'Deux réponses, deux chances.'),h('span',null,'Trouve le titre et l’artiste séparément. Les points acquis restent à toi.')),
          h('li',null,h('strong',null,settings.passage==='random'?'Un autre passage ?':settings.mode==='challenge'?'Un peu plus de musique ?':'Prends ton temps.'),h('span',null,settings.mode==='challenge'?(settings.passage==='random'?'À chaque palier, écoute un autre passage de la même chanson : 1, 2, 4, 8 puis 16 secondes. Les points restants diminuent. Réécouter le passage actuel est gratuit.':'Allonge le même passage : les points restants diminuent. Réécouter le palier actuel est gratuit.'):(settings.passage==='random'?'Change de passage au hasard, à durée constante, ou réécoute le passage actuel. Chaque réponse vaut 1 point.':'Chaque réponse vaut 1 point. Tu peux réécouter et corriger une réponse rejetée.'))),
          h('li',null,h('strong',null,settings.difficulty==='easy'?'Un coup de pouce.':'À toi de retrouver les mots.'),h('span',null,settings.difficulty==='easy'?'Dès la première lettre, des titres et artistes de ta sélection sont proposés. Choisis puis valide ta réponse.':'Saisis le titre et l’artiste sans suggestions. Les petites fautes restent tolérées.')),
          h('li',null,h('strong',null,'Ton prochain record t’attend.'),h('span',null,'Les records Facile et Difficile sont séparés, pour les mêmes sources et règles.'))),
        h('p',{className:'bt-footnote'},'Ferme les notifications et les autres écrans Spotify pour éviter les indices.'))),
    h('footer',{className:'bt-footer'},'Tes réglages et tes records restent sur cet ordinateur.',h('span',null,'SOLO / DÉFI / ENTRAÎNEMENT')));

  if(screen==='results') {
    const errors=game.history.filter(row=>!row.round.title.found || !row.round.artist.found).length;
    const first=game.history.filter(row=>row.round.title.found && row.round.artist.found && row.round.title.step===0 && row.round.artist.step===0).length;
    return h('dialog',stageProps,header,h('section',{className:'bt-results-hero'},h('p',{className:'bt-eyebrow'},record?.assisted?'SESSION D’ENTRAÎNEMENT · HORS RECORD':record?.isNewRecord?'NOUVEAU RECORD PERSONNEL':'PARTIE TERMINÉE'),
      h('h1',null,score>=game.deck.length*core.maxPoints(game.mode)*.7?'Belle oreille.':'On remet ça ?'),h('div',{className:'bt-final-score'},score,h('span',null,` / ${game.deck.length*core.maxPoints(game.mode)}`)),
      h('p',{className:'bt-muted'},`${game.source} · ${game.deck.length} manche${game.deck.length>1?'s':''} · ${game.mode==='challenge'?'Défi':'Entraînement'} · ${game.difficulty==='easy'?'Facile':'Difficile'}`),
      record?.best?h('p',{className:'bt-hint'},`Record automatique pour ces règles : ${record.best.score} / ${record.best.maxScore}`):null,
      record && !record.saved?h('p',{className:'bt-hint',role:'status'},'Le stockage local est indisponible : ce résultat ne sera pas conservé.'):null,
      h('div',{className:'bt-result-stats'},h('div',null,h('strong',null,first),h('span',null,game.mode==='challenge'?'duos trouvés à 1 seconde':'duos retrouvés')),h('div',null,h('strong',null,game.history.filter(row=>row.round.artist.found).length),h('span',null,'artistes reconnus')),h('div',null,h('strong',null,errors),h('span',null,'morceaux à réviser'))),
      h('div',{className:'bt-result-actions'},btn('Nouvelle sélection  →',newSelection,'bt-button bt-primary',{'data-autofocus':true}),errors?btn(`Rejouer mes erreurs (${errors})`,retryErrors):null,btn('Changer les règles',leave,'bt-button bt-text')),errorView),
      h('section',{className:'bt-card'},h('h2',null,'Ta session, morceau par morceau'),h('ol',{className:'bt-history'},game.history.map((row,i)=>h('li',{key:`${row.track.uri}-${i}`},h('span',{className:'bt-number'},String(i+1).padStart(2,'0')),h('div',null,h('strong',null,row.track.title),h('span',{className:'bt-muted'},row.track.artists.join(', ')),h('small',{className:'bt-muted'},`${row.round.title.found?'Titre ✓':'Titre à revoir'} · ${row.round.artist.found?'Artiste ✓':'Artiste à revoir'}${row.round.title.manual || row.round.artist.manual?' · corrigé manuellement':''}`)),h('span',{className:'bt-history-points'},`${core.totalRound(row.round)} / ${core.maxPoints(game.mode)}`))))));
  }

  const available=game.mode==='challenge'?core.STEP_POINTS[round.step]:1;
  function answerField(key,label,placeholder) {
    const answer=round[key];
    return h('div',{className:answer.found?'bt-answer-found':''},h(BlindTestAnswerInput,{key:`${game.id}-${game.index}-${round.step}-${key}`,fieldName:key,label,placeholder,value:answers[key],disabled:answer.found,difficulty:game.difficulty,index:game.suggestionIndex,onChange:value=>setAnswers(current=>({...current,[key]:value}))}),answer.found?h('span',{className:'bt-correct'},`✓ Trouvé · ${answer.points} point${answer.points>1?'s':''} acquis`):h('span',{className:'bt-hint'},`${available} point${available>1?'s':''} à gagner`));
  }
  function revealedField(key,label,value) {
    const answer=round[key],attempted=round.attempts.some(attempt=>String(attempt[key] || '').trim());
    return h('div',{className:'bt-reveal'},h('span',{className:'bt-muted'},label),h('h2',null,value),h('span',{className:answer.found?'bt-correct':'bt-muted'},answer.found?`${answer.points} point${answer.points>1?'s':''}${answer.manual?' · corrigé manuellement':game.mode==='challenge'?` · trouvé à ${core.STEPS[answer.step]} s`:''}`:'Non trouvé'),
      game.mode==='training' && !answer.found && attempted?btn(`Ma réponse ${key==='title'?'au titre':'à l’artiste'} était correcte`,()=>correct(key),'bt-button bt-text'):null);
  }
  return h('dialog',stageProps,header,h('div',{className:'bt-game-top'},h('span',{className:'bt-muted'},`MANCHE ${String(game.index+1).padStart(2,'0')} / ${String(game.deck.length).padStart(2,'0')}`),h('span',{className:'bt-score'},`${score} point${score>1?'s':''}`),btn('Quitter la partie',leave,'bt-button bt-text')),
    h('div',{className:'bt-round-dots','aria-label':`Manche ${game.index+1} sur ${game.deck.length}`},game.deck.map((_,i)=>h('span',{key:i,className:i===game.index?'current':i<game.index?'done':''}))),notice?h('p',{className:'bt-hint'},notice):null,
    h('div',{className:'bt-game-grid'},h('section',{className:'bt-listen-card'},h('p',{className:'bt-eyebrow'},round.revealed?'FIN DU SUSPENSE':game.mode==='challenge'?`PALIER ${round.step+1} / 5`:'ENTRAÎNEMENT'),
      h('h1',null,round.revealed?'C’était…':game.mode==='challenge'?`${seconds} seconde${seconds>1?'s':''}.`:'Tends l’oreille.'),h('p',{className:'bt-intro'},round.revealed?`${core.totalRound(round)} point${core.totalRound(round)>1?'s':''} acquis sur cette manche.`:'Le titre et l’artiste comptent séparément.'),
      game.mode==='challenge'?h('div',{className:'bt-step-ladder','aria-label':'Paliers du défi'},core.STEPS.map((n,i)=>h('div',{key:n,className:i===round.step?'current':i<round.step?'done':''},h('strong',null,`${n} s`),h('span',null,`${core.STEP_POINTS[i]} pts`)))):null,
      round.revealed && track.coverUrl?h('img',{className:'bt-cover',src:track.coverUrl,alt:`Pochette de ${track.title}`,referrerPolicy:'no-referrer',onError:e=>{e.currentTarget.style.display='none';}}):h('div',{className:'bt-wave','aria-hidden':true},[20,34,49,27,63,80,45,96,56,75,36,62,87,43,70,35,52,24,40].map((n,i)=>h('span',{key:i,style:{height:`${n}px`,opacity:playing||round.revealed?1:.45}}))),
      h('div',{className:'bt-time'},h('span',null,`${Math.min(elapsed,durationMs/1000).toFixed(1)} s`),h('span',null,`${Number((durationMs/1000).toFixed(1))} s`)),h('progress',{className:'bt-progress',max:1,value:Math.min(1,elapsed/(durationMs/1000)),'aria-label':'Progression de l’extrait'}),
      !round.revealed?btn(playing?'Arrêter l’extrait':heardStep===round.step?`↻ Réécouter ${seconds} s`:`▶ Écouter ${seconds} s`,playing?stop:listen,'bt-button bt-primary bt-wide',{'data-autofocus':true}):null,
      !round.revealed && game.mode==='challenge' && round.step<4?btn(`${game.passage==='random'?'Autre passage':'Un peu plus'} : ${core.STEPS[round.step+1]} secondes →`,extend,'bt-button bt-secondary bt-wide bt-extend'):null,
      !round.revealed && game.mode==='training' && game.passage==='random'?btn('Autre passage au hasard →',anotherPassage,'bt-button bt-secondary bt-wide bt-extend'):null,
      h('p',{className:'bt-hint'},playing && elapsed===0?'Préparation de l’extrait…':game.mode==='challenge'?(game.passage==='random'?'Un autre passage à chaque palier, avec moins de points à gagner. Réécoute du passage actuel gratuite.':'Même passage à chaque palier. Réécoute gratuite.'):(game.passage==='random'?'Nouveau passage à durée constante · 1 point par réponse.':'Réécoute libre · 1 point par réponse.'))),
    round.revealed?h('section',{className:'bt-card bt-answer-card','aria-live':'polite'},h('p',{className:'bt-eyebrow'},round.title.found && round.artist.found?'LE DUO EST TROUVÉ':'LA RÉPONSE'),revealedField('title','Titre',track.title),revealedField('artist','Artiste',track.artists.join(', ')),
      round.attempts.length?h('p',{className:'bt-hint'},`Ta dernière réponse : ${round.attempts[round.attempts.length-1].title || '—'} / ${round.attempts[round.attempts.length-1].artist || '—'}`):null,
      btn(game.index+1===game.deck.length?'Voir mon score →':'Morceau suivant →',finish,'bt-button bt-primary bt-wide',{'data-autofocus':true})):
    h('form',{className:'bt-card bt-answer-card',onSubmit:submit},h('p',{className:'bt-eyebrow'},game.difficulty==='easy'?'FACILE · AVEC SUGGESTIONS':'DIFFICILE · SANS AIDE'),h('h2',null,'Deux chances de trouver.'),game.difficulty==='easy'?h('p',{className:'bt-hint'},'Tape un titre ou un artiste : des suggestions de ta sélection apparaissent. Choisis au clic ou avec les flèches et Entrée.'):null,answerField('title','Le titre','Le nom du morceau…'),answerField('artist','L’artiste','Qui chante ?'),feedback?h('p',{className:'bt-feedback',role:'status'},feedback):null,errorView,
      h('button',{type:'submit',className:'bt-button bt-primary bt-wide',disabled:heardStep!==round.step || (!round.title.found && !answers.title.trim() && !round.artist.found && !answers.artist.trim()) || (round.title.found && !answers.artist.trim()) || (round.artist.found && !answers.title.trim())},'Valider ma réponse'),
      btn(core.totalRound(round)>0?'Révéler · garder mes points':'Révéler la réponse',reveal,'bt-button bt-text bt-wide'))));
}
