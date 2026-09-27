/* Blind Test 0.3.2 — uses Spotify's React, no external runtime or account. */
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
    open?h('ul',{ref:listRef,id:listId,className:'bt-suggestions',role:'listbox','aria-label':fieldName==='title'?'Title suggestions':'Artist suggestions'},
      matches.map((suggestion,i)=>h('li',{key:suggestion,id:`${listId}-${i}`,role:'option','aria-selected':activeIndex===i,
        onMouseDown:event=>event.preventDefault(),onMouseEnter:()=>setActiveIndex(i),onClick:()=>choose(suggestion)},suggestion))):null,
    searching && !matches.length?h('span',{className:'bt-hint',role:'status'},'No suggestions. You can still type your answer.'):null);
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
  const [loadingLabel, setLoadingLabel] = R.useState('Loading…');
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
  function useLikedSongs() { change('playlists', 'spotify:collection:tracks'); setError(''); setNotice('Liked Songs selected. Choose your rules, then start the game.'); }
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
      try { const uris = pending.uris.map(core.parsePlaylist); setSettings(current => ({...current, playlists:uris.join('\n')})); setNotice('Selection ready. Choose your rules, then start the game.'); } catch (_) { /* Only supported music sources are accepted. */ }
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
    if (!deck.length) throw new Error(rules.mode === 'challenge' ? 'No tracks are long enough for all five steps. Try Practice mode.' : 'No playable tracks in this selection.');
    stop();
    const starts = deck.map(t => preservedStarts?.get(t.uri) ?? core.chooseStart(t, maxSeconds, rules.passage));
    const difficulty = rules.difficulty === 'easy' ? 'easy' : 'hard';
    const sourceCatalog = replay ? catalogRef.current || catalog : catalog;
    // A loaded catalog stays unchanged across redraws and missed-track practice.
    // Build its full index lazily and release it when the catalog is replaced.
    if (difficulty === 'easy' && !sourceCatalog.suggestionIndex) sourceCatalog.suggestionIndex = core.buildSuggestionIndex(sourceCatalog.tracks);
    const suggestionIndex = difficulty === 'easy' ? sourceCatalog.suggestionIndex : null;
    const next = { id:`${Date.now()}-${Math.random()}`,deck,starts,passageStarts:starts.map(start=>[start]),index:0,round:core.createRound(),history:[],mode:rules.mode,passage:rules.passage,seconds:rules.seconds,difficulty,suggestionIndex,
      playlistUris:catalog.uris,source:catalog.name,replay,recordKey:store.recordKey({playlistUris:catalog.uris,...rules,rounds:deck.length}) };
    commit(next); clearRoundUI(); setRecord(null); setScreen('game');
    setNotice(replay ? 'Practice missed tracks · not eligible for records.' : deck.length < rules.rounds ? `${deck.length} round${deck.length!==1?'s':''} available in this selection.` : '');
  }

  async function load(event) {
    event?.preventDefault(); if (busy.current) return;
    let uris;
    try { const lines=settings.playlists.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); if (!lines.length || lines.length>5) throw new Error('Add 1 to 5 sources (playlists or albums), one per line.'); uris=[...new Set(lines.map(core.parsePlaylist))]; }
    catch (cause) { setError(cause.message); return; }
    busy.current=true; const ticket=++operation.current;
    setError('');setNotice('');setScreen('loading');
    try {
      const tracks=[],names=[];
      for (let i=0;i<uris.length;i++) {
        setLoadingLabel(`Loading selection ${i+1} / ${uris.length}…`);
        const data=await adapter.loadPlaylist(uris[i]);
        if (!alive.current || ticket!==operation.current) return;
        tracks.push(...data.tracks);names.push(data.name || 'My selection');
      }
      const catalog={tracks,uris,name:names.join(' + ')};catalogRef.current=catalog;
      startSession(catalog,settings);
    } catch(cause) { if (alive.current && ticket===operation.current) {setError(cause.message || 'Could not load this selection.');setScreen('setup');} }
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
    } catch(cause) {if(alive.current && ticket===operation.current && cause.name!=='AbortError')setError(cause.message || 'Could not play this excerpt. Try again.');}
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
    setFeedback(updated.revealed?'':gained>0?`+${gained} point${gained!==1?'s':''} earned. Keep trying for the other answer.`:current.mode==='challenge'?`Not yet. ${current.passage==='random'?'Try another passage':'Try the next excerpt'}: ${core.STEPS[updated.step]} seconds.`:'Not yet. Replay the excerpt or reveal the answer.');
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
  const header=h('header',{className:'bt-header'},h('div',{className:'bt-brand'},h('span',{className:'bt-logo','aria-hidden':true},'◉'),'BLIND TEST'),h('span',{className:'bt-badge'},preview?'PREVIEW · SIMULATED AUDIO':'BETA · 0.3.2'));
  const errorView=error?h('div',{className:'bt-error',role:'alert'},error):null;
  const stageProps={ref:stageRef,className:'bt-root bt-stage',lang:'en','aria-label':'Blind Test game',onCancel:event=>{event.preventDefault();leave();}};

  if(screen==='setup' || screen==='loading')return h('main',{className:'bt-root',lang:'en'},header,
    h('section',{className:'bt-hero'},h('div',null,h('p',{className:'bt-eyebrow'},'YOUR MUSIC. JUST A FEW NOTES.'),h('h1',null,'Trust your',h('br'),h('em',null,'ears.')),h('p',{className:'bt-intro'},'Name the artist. Find the song. How many seconds will you need?')),
      h('div',{className:'bt-record','aria-hidden':true},h('div',{className:'bt-record-label'},'SIDE B',h('strong',null,'?'),'1 → 16 s'))),
    h('div',{className:'bt-setup-grid'},h('form',{className:'bt-card',onSubmit:load},
      h('div',{className:'bt-section-title'},h('span',{className:'bt-number'},'01'),h('h2',null,'Set up your game')),
      h('fieldset',{className:'bt-mode-picker',disabled:screen==='loading'},h('legend',null,'Game mode'),
        ['challenge','training'].map(value=>h('label',{key:value,className:settings.mode===value?'bt-mode selected':'bt-mode'},h('input',{type:'radio',name:'game-mode',value,checked:settings.mode===value,onChange:()=>change('mode',value)}),h('span',null,h('strong',null,value==='challenge'?'Progressive Challenge':'Practice'),h('small',null,value==='challenge'?'1, 2, 4, 8, 16 seconds':'Your pace, your excerpt length'))))),
      h('fieldset',{className:'bt-mode-picker',disabled:screen==='loading'},h('legend',null,'Difficulty'),
        ['easy','hard'].map(value=>h('label',{key:value,className:settings.difficulty===value?'bt-mode selected':'bt-mode'},h('input',{type:'radio',name:'game-difficulty',value,checked:settings.difficulty===value,onChange:()=>change('difficulty',value)}),h('span',null,h('strong',null,value==='easy'?'Easy':'Hard'),h('small',null,value==='easy'?'Suggestions as you type':'Answers without hints'))))),
      h('div',{className:'bt-source-shortcuts'},btn('♥ My Liked Songs',useLikedSongs,'bt-button bt-secondary',{disabled:screen==='loading'})),
      field('Spotify playlists or albums · one link per line',h('textarea',{name:'playlists',rows:3,value:settings.playlists,placeholder:'https://open.spotify.com/playlist/… or /album/…',autoComplete:'off',spellCheck:false,required:true,disabled:screen==='loading',onChange:e=>change('playlists',e.target.value)})),
      h('p',{className:'bt-hint'},'Up to 5 sources. Use Liked Songs or paste links. Right-click a playlist or album → Play Blind Test.'),
      h('div',{className:'bt-options'},field('Rounds',h('select',{value:settings.rounds,disabled:screen==='loading',onChange:e=>change('rounds',Number(e.target.value))},[5,10,15,20].map(n=>h('option',{key:n,value:n},`${n} tracks`)))),
        field('Passage',h('select',{value:settings.passage,disabled:screen==='loading',onChange:e=>change('passage',e.target.value)},h('option',{value:'intro'},'Beginning'),h('option',{value:'random'},'Random'))),
        settings.mode==='training'?field('Excerpt length',h('select',{value:settings.seconds,disabled:screen==='loading',onChange:e=>change('seconds',Number(e.target.value))},[5,10,15,20].map(n=>h('option',{key:n,value:n},`${n} seconds`)))):null),
      notice?h('p',{className:'bt-hint',role:'status'},notice):null,errorView,h('button',{className:'bt-button bt-primary bt-wide',type:'submit',disabled:screen==='loading'},screen==='loading'?loadingLabel:'Start game  →'),screen==='loading'?btn('Cancel',leave,'bt-button bt-text'):null),
      h('aside',{className:'bt-card bt-rules'},h('p',{className:'bt-eyebrow'},settings.mode==='challenge'?'THE CHALLENGE':'PRACTICE'),h('h2',null,settings.mode==='challenge'?'One second.':'Listen. Guess.',h('br'),settings.mode==='challenge'?'Maybe enough.':'At your own pace.'),
        settings.mode==='challenge'?h('div',{className:'bt-preview-steps'},core.STEPS.map((n,i)=>h('div',{key:n},h('strong',null,`${n} s`),h('span',null,`${core.STEP_POINTS[i]} pts`)))):null,
        h('ol',null,h('li',null,h('strong',null,'Two answers, two chances.'),h('span',null,'Guess the title and artist separately. Keep the points you earn.')),
          h('li',null,h('strong',null,settings.passage==='random'?'Another passage?':settings.mode==='challenge'?'Need more music?':'Take your time.'),h('span',null,settings.mode==='challenge'?(settings.passage==='random'?'Each step plays another passage of the same song: 1, 2, 4, 8, then 16 seconds. Available points decrease. Replaying the current passage is free.':'Extend the same passage for fewer points. Replaying the current step is free.'):(settings.passage==='random'?'Try another random passage at the same length, or replay the current one. Each answer earns 1 point.':'Each answer earns 1 point. Replay freely and correct a rejected answer after revealing it.'))),
          h('li',null,h('strong',null,settings.difficulty==='easy'?'A helping hand.':'Find the right words.'),h('span',null,settings.difficulty==='easy'?'Start typing to see titles and artists from your selection. Pick a suggestion, then submit your answer.':'Type the title and artist without suggestions. Small typos are still accepted.')),
          h('li',null,h('strong',null,'Your next record awaits.'),h('span',null,'Easy and Hard records are separate for the same sources and rules.'))),
        h('p',{className:'bt-footnote'},'Hide notifications and other Spotify screens to avoid spoilers.'))),
    h('footer',{className:'bt-footer'},'Your settings and records stay on this computer.',h('span',null,'SOLO / CHALLENGE / PRACTICE')));

  if(screen==='results') {
    const errors=game.history.filter(row=>!row.round.title.found || !row.round.artist.found).length;
    const first=game.history.filter(row=>row.round.title.found && row.round.artist.found && row.round.title.step===0 && row.round.artist.step===0).length;
    return h('dialog',stageProps,header,h('section',{className:'bt-results-hero'},h('p',{className:'bt-eyebrow'},record?.assisted?'PRACTICE SESSION · NOT ELIGIBLE FOR RECORDS':record?.isNewRecord?'NEW PERSONAL BEST':'GAME COMPLETE'),
      h('h1',null,score>=game.deck.length*core.maxPoints(game.mode)*.7?'Great ears.':'Another round?'),h('div',{className:'bt-final-score'},score,h('span',null,` / ${game.deck.length*core.maxPoints(game.mode)}`)),
      h('p',{className:'bt-muted'},`${game.source} · ${game.deck.length} round${game.deck.length!==1?'s':''} · ${game.mode==='challenge'?'Challenge':'Practice'} · ${game.difficulty==='easy'?'Easy':'Hard'}`),
      record?.best?h('p',{className:'bt-hint'},`Personal best for these rules: ${record.best.score} / ${record.best.maxScore}`):null,
      record && !record.saved?h('p',{className:'bt-hint',role:'status'},'Local storage is unavailable. This result will not be saved.'):null,
      h('div',{className:'bt-result-stats'},h('div',null,h('strong',null,first),h('span',null,game.mode==='challenge'?'pairs found in 1 second':'pairs found')),h('div',null,h('strong',null,game.history.filter(row=>row.round.artist.found).length),h('span',null,'artists recognized')),h('div',null,h('strong',null,errors),h('span',null,errors===1?'track to practice':'tracks to practice'))),
      h('div',{className:'bt-result-actions'},btn('New selection  →',newSelection,'bt-button bt-primary',{'data-autofocus':true}),errors?btn(`Practice missed tracks (${errors})`,retryErrors):null,btn('Change rules',leave,'bt-button bt-text')),errorView),
      h('section',{className:'bt-card'},h('h2',null,'Your session, track by track'),h('ol',{className:'bt-history'},game.history.map((row,i)=>h('li',{key:`${row.track.uri}-${i}`},h('span',{className:'bt-number'},String(i+1).padStart(2,'0')),h('div',null,h('strong',null,row.track.title),h('span',{className:'bt-muted'},row.track.artists.join(', ')),h('small',{className:'bt-muted'},`${row.round.title.found?'Title ✓':'Title to practice'} · ${row.round.artist.found?'Artist ✓':'Artist to practice'}${row.round.title.manual || row.round.artist.manual?' · manually corrected':''}`)),h('span',{className:'bt-history-points'},`${core.totalRound(row.round)} / ${core.maxPoints(game.mode)}`))))));
  }

  const available=game.mode==='challenge'?core.STEP_POINTS[round.step]:1;
  function answerField(key,label,placeholder) {
    const answer=round[key];
    return h('div',{className:answer.found?'bt-answer-found':''},h(BlindTestAnswerInput,{key:`${game.id}-${game.index}-${round.step}-${key}`,fieldName:key,label,placeholder,value:answers[key],disabled:answer.found,difficulty:game.difficulty,index:game.suggestionIndex,onChange:value=>setAnswers(current=>({...current,[key]:value}))}),answer.found?h('span',{className:'bt-correct'},`✓ Found · ${answer.points} point${answer.points!==1?'s':''} earned`):h('span',{className:'bt-hint'},`${available} point${available!==1?'s':''} available`));
  }
  function revealedField(key,label,value) {
    const answer=round[key],attempted=round.attempts.some(attempt=>String(attempt[key] || '').trim());
    return h('div',{className:'bt-reveal'},h('span',{className:'bt-muted'},label),h('h2',null,value),h('span',{className:answer.found?'bt-correct':'bt-muted'},answer.found?`${answer.points} point${answer.points!==1?'s':''}${answer.manual?' · manually corrected':game.mode==='challenge'?` · found at ${core.STEPS[answer.step]} s`:''}`:'Not found'),
      game.mode==='training' && !answer.found && attempted?btn(`My ${key==='title'?'title':'artist'} answer was correct`,()=>correct(key),'bt-button bt-text'):null);
  }
  return h('dialog',stageProps,header,h('div',{className:'bt-game-top'},h('span',{className:'bt-muted'},`ROUND ${String(game.index+1).padStart(2,'0')} / ${String(game.deck.length).padStart(2,'0')}`),h('span',{className:'bt-score'},`${score} point${score!==1?'s':''}`),btn('Quit game',leave,'bt-button bt-text')),
    h('div',{className:'bt-round-dots','aria-label':`Round ${game.index+1} of ${game.deck.length}`},game.deck.map((_,i)=>h('span',{key:i,className:i===game.index?'current':i<game.index?'done':''}))),notice?h('p',{className:'bt-hint'},notice):null,
    h('div',{className:'bt-game-grid'},h('section',{className:'bt-listen-card'},h('p',{className:'bt-eyebrow'},round.revealed?'THE REVEAL':game.mode==='challenge'?`STEP ${round.step+1} / 5`:'PRACTICE'),
      h('h1',null,round.revealed?'It was…':game.mode==='challenge'?`${seconds} second${seconds!==1?'s':''}.`:'Listen closely.'),h('p',{className:'bt-intro'},round.revealed?`${core.totalRound(round)} point${core.totalRound(round)!==1?'s':''} earned this round.`:'The title and artist score separately.'),
      game.mode==='challenge'?h('div',{className:'bt-step-ladder','aria-label':'Challenge steps'},core.STEPS.map((n,i)=>h('div',{key:n,className:i===round.step?'current':i<round.step?'done':''},h('strong',null,`${n} s`),h('span',null,`${core.STEP_POINTS[i]} pts`)))):null,
      round.revealed && track.coverUrl?h('img',{className:'bt-cover',src:track.coverUrl,alt:`Cover art for ${track.title}`,referrerPolicy:'no-referrer',onError:e=>{e.currentTarget.style.display='none';}}):h('div',{className:'bt-wave','aria-hidden':true},[20,34,49,27,63,80,45,96,56,75,36,62,87,43,70,35,52,24,40].map((n,i)=>h('span',{key:i,style:{height:`${n}px`,opacity:playing||round.revealed?1:.45}}))),
      h('div',{className:'bt-time'},h('span',null,`${Math.min(elapsed,durationMs/1000).toFixed(1)} s`),h('span',null,`${Number((durationMs/1000).toFixed(1))} s`)),h('progress',{className:'bt-progress',max:1,value:Math.min(1,elapsed/(durationMs/1000)),'aria-label':'Excerpt progress'}),
      !round.revealed?btn(playing?'Stop excerpt':heardStep===round.step?`↻ Replay ${seconds} s`:`▶ Listen ${seconds} s`,playing?stop:listen,'bt-button bt-primary bt-wide',{'data-autofocus':true}):null,
      !round.revealed && game.mode==='challenge' && round.step<4?btn(`${game.passage==='random'?'Another passage':'More music'}: ${core.STEPS[round.step+1]} seconds →`,extend,'bt-button bt-secondary bt-wide bt-extend'):null,
      !round.revealed && game.mode==='training' && game.passage==='random'?btn('Another random passage →',anotherPassage,'bt-button bt-secondary bt-wide bt-extend'):null,
      h('p',{className:'bt-hint'},playing && elapsed===0?'Preparing excerpt…':game.mode==='challenge'?(game.passage==='random'?'A new passage at each step, with fewer points available. Replay the current passage for free.':'Same passage at each step. Free replay.'):(game.passage==='random'?'New passage, same length · 1 point per answer.':'Replay freely · 1 point per answer.'))),
    round.revealed?h('section',{className:'bt-card bt-answer-card','aria-live':'polite'},h('p',{className:'bt-eyebrow'},round.title.found && round.artist.found?'BOTH ANSWERS FOUND':'THE ANSWER'),revealedField('title','Title',track.title),revealedField('artist','Artist',track.artists.join(', ')),
      round.attempts.length?h('p',{className:'bt-hint'},`Your last answer: ${round.attempts[round.attempts.length-1].title || '—'} / ${round.attempts[round.attempts.length-1].artist || '—'}`):null,
      btn(game.index+1===game.deck.length?'See my score →':'Next track →',finish,'bt-button bt-primary bt-wide',{'data-autofocus':true})):
    h('form',{className:'bt-card bt-answer-card',onSubmit:submit},h('p',{className:'bt-eyebrow'},game.difficulty==='easy'?'EASY · WITH SUGGESTIONS':'HARD · NO HINTS'),h('h2',null,'Two chances to guess.'),game.difficulty==='easy'?h('p',{className:'bt-hint'},'Type a title or artist to see suggestions from your selection. Choose with a click or the arrow keys and Enter.'):null,answerField('title','Title','Song title…'),answerField('artist','Artist','Who is the artist?'),feedback?h('p',{className:'bt-feedback',role:'status'},feedback):null,errorView,
      h('button',{type:'submit',className:'bt-button bt-primary bt-wide',disabled:heardStep!==round.step || (!round.title.found && !answers.title.trim() && !round.artist.found && !answers.artist.trim()) || (round.title.found && !answers.artist.trim()) || (round.artist.found && !answers.title.trim())},'Submit answer'),
      btn(core.totalRound(round)>0?'Reveal · keep my points':'Reveal answer',reveal,'bt-button bt-text bt-wide'))));
}
