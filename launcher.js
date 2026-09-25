/* Spicetify startup extension: playlist/album/liked-songs menu, never starts playback. */
(function(root) {
  'use strict';
  if (root.__blindTestLauncherV2) return;
  root.__blindTestLauncherV2 = { attempts: 0, item: null, timer: null, error: null, subscribed: false };
  const state = root.__blindTestLauncherV2;
  const isSource = uri => typeof uri === 'string' && (uri === 'spotify:collection:tracks' || /^spotify:(?:playlist|album):[A-Za-z0-9]{22}$/.test(uri));
  const canLaunch = uris => Array.isArray(uris) && uris.length > 0 && uris.length <= 5 && uris.every(isSource);
  function fromProps(props) {
    const uri = props?.uri ?? props?.item?.uri ?? props?.reference?.uri;
    return props?.uris ?? (uri ? [uri] : []);
  }
  function launch(uris) {
    if (!canLaunch(uris)) return;
    const pending = { uris: [...new Set(uris)], at: Date.now() };
    root.__blindTestPendingV2 = pending;
    try { root.localStorage.setItem('blind-test:launch:v2', JSON.stringify(pending)); } catch (_) { /* Same-window fallback above. */ }
    root.dispatchEvent(new Event('blind-test:launch'));
    root.Spicetify.Platform.History.push('/blind-test');
  }
  function retry() {
    if (++state.attempts < 60) state.timer = setTimeout(register, 500);
  }
  function register() {
    // Subscribe once even when Spicetify itself appears after this extension.
    // The event can invoke its listener synchronously if it already fired.
    const ready = root.Spicetify?.Events?.webpackLoaded;
    if (!state.subscribed && typeof ready?.on === 'function') {
      state.subscribed = true;
      ready.on(() => { if (!state.item) { state.attempts = 0; register(); } });
    }
    if (state.timer !== null) { clearTimeout(state.timer); state.timer = null; }
    if (state.item) return;
    const sp = root.Spicetify;
    const Item = sp?.ContextMenu?.Item;
    const ItemV2 = sp?.ContextMenuV2?.Item;
    // In 2.45.1 the constructors exist before webpack resolves ReactJSX. A
    // premature construction throws and used to leave a permanent singleton.
    if ((!Item && !ItemV2) || typeof sp?.Platform?.History?.push !== 'function'
      || typeof sp?.React?.createElement !== 'function'
      || (ItemV2 && typeof sp?.ReactJSX?.jsx !== 'function')) {
      retry();
      return;
    }
    try {
      const item = Item ? new Item('Jouer au blind test', launch, canLaunch, 'play')
        : new ItemV2({ children: 'Jouer au blind test', leadingIcon: 'play',
          onClick: context => launch(fromProps(context?.props)), shouldAdd: props => canLaunch(fromProps(props)) });
      item.register();
      state.item = item;
      state.error = null;
    } catch (cause) {
      state.error = cause?.message || 'Menu indisponible.';
      retry();
    }
  }
  register();
})(globalThis);
