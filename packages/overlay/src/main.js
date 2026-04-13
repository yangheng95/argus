true              &&(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload"))
    return;
  for (const link of document.querySelectorAll('link[rel="modulepreload"]'))
    processPreload(link);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList")
        continue;
      for (const node of mutation.addedNodes)
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity)
      fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy)
      fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous")
      fetchOpts.credentials = "omit";
    else
      fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
}());

const IS_DEV = false;
const equalFn = (a, b) => a === b;
const $PROXY = Symbol("solid-proxy");
const $TRACK = Symbol("solid-track");
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const NO_INIT = {};
var Owner = null;
let Transition = null;
let ExternalSourceConfig = null;
let Listener = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  const listener = Listener,
    owner = Owner,
    unowned = fn.length === 0,
    current = detachedOwner === undefined ? owner : detachedOwner,
    root = unowned ? UNOWNED : {
      owned: null,
      cleanups: null,
      context: current ? current.context : null,
      owner: current
    },
    updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  const setter = value => {
    if (typeof value === "function") {
      value = value(s.value);
    }
    return writeSignal(s, value);
  };
  return [readSignal.bind(s), setter];
}
function createComputed(fn, value, options) {
  const c = createComputation(fn, value, true, STALE);
  updateComputation(c);
}
function createRenderEffect(fn, value, options) {
  const c = createComputation(fn, value, false, STALE);
  updateComputation(c);
}
function createEffect(fn, value, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE);
  c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return readSignal.bind(c);
}
function isPromise(v) {
  return v && typeof v === "object" && "then" in v;
}
function createResource(pSource, pFetcher, pOptions) {
  let source;
  let fetcher;
  let options;
  if (typeof pFetcher === "function") {
    source = pSource;
    fetcher = pFetcher;
    options = {};
  } else {
    source = true;
    fetcher = pSource;
    options = pFetcher || {};
  }
  let pr = null,
    initP = NO_INIT,
    scheduled = false,
    resolved = "initialValue" in options,
    dynamic = typeof source === "function" && createMemo(source);
  const contexts = new Set(),
    [value, setValue] = (options.storage || createSignal)(options.initialValue),
    [error, setError] = createSignal(undefined),
    [track, trigger] = createSignal(undefined, {
      equals: false
    }),
    [state, setState] = createSignal(resolved ? "ready" : "unresolved");
  function loadEnd(p, v, error, key) {
    if (pr === p) {
      pr = null;
      key !== undefined && (resolved = true);
      if ((p === initP || v === initP) && options.onHydrated) queueMicrotask(() => options.onHydrated(key, {
        value: v
      }));
      initP = NO_INIT;
      completeLoad(v, error);
    }
    return v;
  }
  function completeLoad(v, err) {
    runUpdates(() => {
      if (err === undefined) setValue(() => v);
      setState(err !== undefined ? "errored" : resolved ? "ready" : "unresolved");
      setError(err);
      for (const c of contexts.keys()) c.decrement();
      contexts.clear();
    }, false);
  }
  function read() {
    const c = SuspenseContext,
      v = value(),
      err = error();
    if (err !== undefined && !pr) throw err;
    if (Listener && !Listener.user && c) ;
    return v;
  }
  function load(refetching = true) {
    if (refetching !== false && scheduled) return;
    scheduled = false;
    const lookup = dynamic ? dynamic() : source;
    if (lookup == null || lookup === false) {
      loadEnd(pr, untrack(value));
      return;
    }
    let error;
    const p = initP !== NO_INIT ? initP : untrack(() => {
      try {
        return fetcher(lookup, {
          value: value(),
          refetching
        });
      } catch (fetcherError) {
        error = fetcherError;
      }
    });
    if (error !== undefined) {
      loadEnd(pr, undefined, castError(error), lookup);
      return;
    } else if (!isPromise(p)) {
      loadEnd(pr, p, undefined, lookup);
      return p;
    }
    pr = p;
    if ("v" in p) {
      if (p.s === 1) loadEnd(pr, p.v, undefined, lookup);else loadEnd(pr, undefined, castError(p.v), lookup);
      return p;
    }
    scheduled = true;
    queueMicrotask(() => scheduled = false);
    runUpdates(() => {
      setState(resolved ? "refreshing" : "pending");
      trigger();
    }, false);
    return p.then(v => loadEnd(p, v, undefined, lookup), e => loadEnd(p, undefined, castError(e), lookup));
  }
  Object.defineProperties(read, {
    state: {
      get: () => state()
    },
    error: {
      get: () => error()
    },
    loading: {
      get() {
        const s = state();
        return s === "pending" || s === "refreshing";
      }
    },
    latest: {
      get() {
        if (!resolved) return read();
        const err = error();
        if (err && !pr) throw err;
        return value();
      }
    }
  });
  let owner = Owner;
  if (dynamic) createComputed(() => (owner = Owner, load(false)));else load(false);
  return [read, {
    refetch: info => runWithOwner(owner, () => load(info)),
    mutate: setValue
  }];
}
function batch(fn) {
  return runUpdates(fn, false);
}
function untrack(fn) {
  if (Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) ;
    return fn();
  } finally {
    Listener = listener;
  }
}
function onMount(fn) {
  createEffect(() => untrack(fn));
}
function onCleanup(fn) {
  if (Owner === null) ;else if (Owner.cleanups === null) Owner.cleanups = [fn];else Owner.cleanups.push(fn);
  return fn;
}
function getListener() {
  return Listener;
}
function runWithOwner(o, fn) {
  const prev = Owner;
  const prevListener = Listener;
  Owner = o;
  Listener = null;
  try {
    return runUpdates(fn, true);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = prev;
    Listener = prevListener;
  }
}
const [transPending, setTransPending] = /*@__PURE__*/createSignal(false);
function children(fn) {
  const children = createMemo(fn);
  const memo = createMemo(() => resolveChildren(children()));
  memo.toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo;
}
let SuspenseContext;
function readSignal() {
  if (this.sources && (this.state)) {
    if ((this.state) === STALE) updateComputation(this);else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots.push(Listener.sources.length - 1);
    }
  }
  return this.value;
}
function writeSignal(node, value, isComp) {
  let current = node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    node.value = value;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o)) ;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure) Updates.push(o);else Effects.push(o);
            if (o.observers) markDownstream(o);
          }
          if (!TransitionRunning) o.state = STALE;
        }
        if (Updates.length > 10e5) {
          Updates = [];
          if (IS_DEV) ;
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}
function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(node, node.value, time);
}
function runComputation(node, value, time) {
  let nextValue;
  const owner = Owner,
    listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Owner === null) ;else if (Owner !== UNOWNED) {
    {
      if (!Owner.owned) Owner.owned = [c];else Owner.owned.push(c);
    }
  }
  return c;
}
function runTop(node) {
  if ((node.state) === 0) return;
  if ((node.state) === PENDING) return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if ((node.state) === STALE) {
      updateComputation(node);
    } else if ((node.state) === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e), false);
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function runUserEffects(queue) {
  let i,
    userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);else queue[userLength++] = e;
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  node.state = 0;
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount)) runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates.push(o);else Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(),
        index = node.sourceSlots.pop(),
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(),
          s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  node.state = 0;
}
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function handleError(err, owner = Owner) {
  const error = castError(err);
  throw error;
}
function resolveChildren(children) {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results = [];
    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}

const FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    len = 0,
    indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [],
      newLen = newItems.length,
      i,
      j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      }
      else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);
        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = new Map();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
function indexArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    signals = [],
    len = 0,
    i;
  onCleanup(() => dispose(disposers));
  return () => {
    const newItems = list() || [],
      newLen = newItems.length;
    newItems[$TRACK];
    return untrack(() => {
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          signals = [];
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
        return mapped;
      }
      if (items[0] === FALLBACK) {
        disposers[0]();
        disposers = [];
        items = [];
        mapped = [];
        len = 0;
      }
      for (i = 0; i < newLen; i++) {
        if (i < items.length && items[i] !== newItems[i]) {
          signals[i](() => newItems[i]);
        } else if (i >= items.length) {
          mapped[i] = createRoot(mapper);
        }
      }
      for (; i < items.length; i++) {
        disposers[i]();
      }
      len = signals.length = disposers.length = newLen;
      items = newItems.slice(0);
      return mapped = mapped.slice(0, len);
    });
    function mapper(disposer) {
      disposers[i] = disposer;
      const [s, set] = createSignal(newItems[i]);
      signals[i] = set;
      return mapFn(s, i);
    }
  };
}
function createComponent(Comp, props) {
  return untrack(() => Comp(props || {}));
}

const narrowedError = name => `Stale read from <${name}>.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || undefined));
}
function Index(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(indexArray(() => props.each, props.children, fallback || undefined));
}
function Show(props) {
  const keyed = props.keyed;
  const conditionValue = createMemo(() => props.when, undefined, undefined);
  const condition = keyed ? conditionValue : createMemo(conditionValue, undefined, {
    equals: (a, b) => !a === !b
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn ? untrack(() => child(keyed ? c : () => {
        if (!untrack(condition)) throw narrowedError("Show");
        return conditionValue();
      })) : child;
    }
    return props.fallback;
  }, undefined, undefined);
}
function Switch(props) {
  const chs = children(() => props.children);
  const switchFunc = createMemo(() => {
    const ch = chs();
    const mps = Array.isArray(ch) ? ch : [ch];
    let func = () => undefined;
    for (let i = 0; i < mps.length; i++) {
      const index = i;
      const mp = mps[i];
      const prevFunc = func;
      const conditionValue = createMemo(() => prevFunc() ? undefined : mp.when, undefined, undefined);
      const condition = mp.keyed ? conditionValue : createMemo(conditionValue, undefined, {
        equals: (a, b) => !a === !b
      });
      func = () => prevFunc() || (condition() ? [index, conditionValue, mp] : undefined);
    }
    return func;
  });
  return createMemo(() => {
    const sel = switchFunc()();
    if (!sel) return props.fallback;
    const [index, conditionValue, mp] = sel;
    const child = mp.children;
    const fn = typeof child === "function" && child.length > 0;
    return fn ? untrack(() => child(mp.keyed ? conditionValue() : () => {
      if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
      return conditionValue();
    })) : child;
  }, undefined, undefined);
}
function Match(props) {
  return props;
}

const memo = fn => createMemo(() => fn());

function reconcileArrays(parentNode, a, b) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    after = a[aEnd - 1].nextSibling,
    map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}

const $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init, options = {}) {
  let disposer;
  createRoot(dispose => {
    disposer = dispose;
    element === document ? code() : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG, isMathML) {
  let node;
  const create = () => {
    const t = document.createElement("template");
    t.innerHTML = html;
    return t.content.firstChild;
  };
  const fn = () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}
function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);else node.setAttribute(name, value);
}
function className(node, value) {
  if (value == null) node.removeAttribute("class");else node.className = value;
}
function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, handler[0] = e => handlerFn.call(node, handler[1], e));
  } else node.addEventListener(name, handler, typeof handler !== "function" && handler);
}
function setStyleProperty(node, name, value) {
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
}
function use(fn, element, arg) {
  return untrack(() => fn(element, arg));
}
function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
}
function eventHandler(e) {
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = value => Object.defineProperty(e, "target", {
    configurable: true,
    value
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host));
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break;
      }
    }
  }
  else walkUpTree();
  retarget(oriTarget);
}
function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = multi && current[0] && current[0].parentNode || parent;
  if (t === "string" || t === "number") {
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else ;
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      prev = current && current[normalized.length],
      t;
    if (item == null || item === true || item === false) ; else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return parent.textContent = "";
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}

/**
 * marked v17.0.1 - a markdown parser
 * Copyright (c) 2018-2025, MarkedJS. (MIT License)
 * Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
 * https://github.com/markedjs/marked
 */

/**
 * DO NOT EDIT THIS FILE
 * The code in this file is generated from files in ./src/
 */

function L(){return {async:false,breaks:false,extensions:null,gfm:true,hooks:null,pedantic:false,renderer:null,silent:false,tokenizer:null,walkTokens:null}}var T=L();function Z(u){T=u;}var C={exec:()=>null};function k(u,e=""){let t=typeof u=="string"?u:u.source,n={replace:(r,i)=>{let s=typeof i=="string"?i:i.source;return s=s.replace(m.caret,"$1"),t=t.replace(r,s),n},getRegex:()=>new RegExp(t,e)};return n}var me=(()=>{try{return !!new RegExp("(?<=1)(?<!1)")}catch{return  false}})(),m={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:u=>new RegExp(`^( {0,3}${u})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:u=>new RegExp(`^ {0,${Math.min(3,u-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:u=>new RegExp(`^ {0,${Math.min(3,u-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:u=>new RegExp(`^ {0,${Math.min(3,u-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:u=>new RegExp(`^ {0,${Math.min(3,u-1)}}#`),htmlBeginRegex:u=>new RegExp(`^ {0,${Math.min(3,u-1)}}<(?:[a-z].*>|!--)`,"i")},xe=/^(?:[ \t]*(?:\n|$))+/,be=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,Re=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,I=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,Te=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,N=/(?:[*+-]|\d{1,9}[.)])/,re=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,se=k(re).replace(/bull/g,N).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),Oe=k(re).replace(/bull/g,N).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Q=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,we=/^[^\n]+/,F=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,ye=k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",F).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),Pe=k(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,N).getRegex(),v="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",j=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,Se=k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",j).replace("tag",v).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),ie=k(Q).replace("hr",I).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex(),$e=k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",ie).getRegex(),U={blockquote:$e,code:be,def:ye,fences:Re,heading:Te,hr:I,html:Se,lheading:se,list:Pe,newline:xe,paragraph:ie,table:C,text:we},te=k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",I).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex(),_e={...U,lheading:Oe,table:te,paragraph:k(Q).replace("hr",I).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",te).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex()},Le={...U,html:k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",j).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:C,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:k(Q).replace("hr",I).replace("heading",` *#{1,6} *[^
]`).replace("lheading",se).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Me=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,ze=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,oe=/^( {2,}|\\)\n(?!\s*$)/,Ae=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,D=/[\p{P}\p{S}]/u,K=/[\s\p{P}\p{S}]/u,ae=/[^\s\p{P}\p{S}]/u,Ce=k(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,K).getRegex(),le=/(?!~)[\p{P}\p{S}]/u,Ie=/(?!~)[\s\p{P}\p{S}]/u,Ee=/(?:[^\s\p{P}\p{S}]|~)/u,Be=k(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",me?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),ue=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,qe=k(ue,"u").replace(/punct/g,D).getRegex(),ve=k(ue,"u").replace(/punct/g,le).getRegex(),pe="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",De=k(pe,"gu").replace(/notPunctSpace/g,ae).replace(/punctSpace/g,K).replace(/punct/g,D).getRegex(),He=k(pe,"gu").replace(/notPunctSpace/g,Ee).replace(/punctSpace/g,Ie).replace(/punct/g,le).getRegex(),Ze=k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,ae).replace(/punctSpace/g,K).replace(/punct/g,D).getRegex(),Ge=k(/\\(punct)/,"gu").replace(/punct/g,D).getRegex(),Ne=k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Qe=k(j).replace("(?:-->|$)","-->").getRegex(),Fe=k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Qe).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),q=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,je=k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",q).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),ce=k(/^!?\[(label)\]\[(ref)\]/).replace("label",q).replace("ref",F).getRegex(),he=k(/^!?\[(ref)\](?:\[\])?/).replace("ref",F).getRegex(),Ue=k("reflink|nolink(?!\\()","g").replace("reflink",ce).replace("nolink",he).getRegex(),ne=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,W={_backpedal:C,anyPunctuation:Ge,autolink:Ne,blockSkip:Be,br:oe,code:ze,del:C,emStrongLDelim:qe,emStrongRDelimAst:De,emStrongRDelimUnd:Ze,escape:Me,link:je,nolink:he,punctuation:Ce,reflink:ce,reflinkSearch:Ue,tag:Fe,text:Ae,url:C},Ke={...W,link:k(/^!?\[(label)\]\((.*?)\)/).replace("label",q).getRegex(),reflink:k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",q).getRegex()},G={...W,emStrongRDelimAst:He,emStrongLDelim:ve,url:k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",ne).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:k(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",ne).getRegex()},We={...G,br:k(oe).replace("{2,}","*").getRegex(),text:k(G.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},E={normal:U,gfm:_e,pedantic:Le},M={normal:W,gfm:G,breaks:We,pedantic:Ke};var Xe={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},ke=u=>Xe[u];function w(u,e){if(e){if(m.escapeTest.test(u))return u.replace(m.escapeReplace,ke)}else if(m.escapeTestNoEncode.test(u))return u.replace(m.escapeReplaceNoEncode,ke);return u}function X(u){try{u=encodeURI(u).replace(m.percentDecode,"%");}catch{return null}return u}function J(u,e){let t=u.replace(m.findPipe,(i,s,a)=>{let o=false,l=s;for(;--l>=0&&a[l]==="\\";)o=!o;return o?"|":" |"}),n=t.split(m.splitPipe),r=0;if(n[0].trim()||n.shift(),n.length>0&&!n.at(-1)?.trim()&&n.pop(),e)if(n.length>e)n.splice(e);else for(;n.length<e;)n.push("");for(;r<n.length;r++)n[r]=n[r].trim().replace(m.slashPipe,"|");return n}function z(u,e,t){let n=u.length;if(n===0)return "";let r=0;for(;r<n;){let i=u.charAt(n-r-1);if(i===e&&true)r++;else break}return u.slice(0,n-r)}function de(u,e){if(u.indexOf(e[1])===-1)return  -1;let t=0;for(let n=0;n<u.length;n++)if(u[n]==="\\")n++;else if(u[n]===e[0])t++;else if(u[n]===e[1]&&(t--,t<0))return n;return t>0?-2:-1}function ge(u,e,t,n,r){let i=e.href,s=e.title||null,a=u[1].replace(r.other.outputLinkReplace,"$1");n.state.inLink=true;let o={type:u[0].charAt(0)==="!"?"image":"link",raw:t,href:i,title:s,text:a,tokens:n.inlineTokens(a)};return n.state.inLink=false,o}function Je(u,e,t){let n=u.match(t.other.indentCodeCompensation);if(n===null)return e;let r=n[1];return e.split(`
`).map(i=>{let s=i.match(t.other.beginningSpace);if(s===null)return i;let[a]=s;return a.length>=r.length?i.slice(r.length):i}).join(`
`)}var y=class{options;rules;lexer;constructor(e){this.options=e||T;}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return {type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return {type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:z(n,`
`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],r=Je(n,t[3]||"",this.rules);return {type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:r}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let r=z(n,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(n=r.trim());}return {type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return {type:"hr",raw:z(t[0],`
`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=z(t[0],`
`).split(`
`),r="",i="",s=[];for(;n.length>0;){let a=false,o=[],l;for(l=0;l<n.length;l++)if(this.rules.other.blockquoteStart.test(n[l]))o.push(n[l]),a=true;else if(!a)o.push(n[l]);else break;n=n.slice(l);let p=o.join(`
`),c=p.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?`${r}
${p}`:p,i=i?`${i}
${c}`:c;let g=this.lexer.state.top;if(this.lexer.state.top=true,this.lexer.blockTokens(c,s,true),this.lexer.state.top=g,n.length===0)break;let h=s.at(-1);if(h?.type==="code")break;if(h?.type==="blockquote"){let R=h,f=R.raw+`
`+n.join(`
`),O=this.blockquote(f);s[s.length-1]=O,r=r.substring(0,r.length-R.raw.length)+O.raw,i=i.substring(0,i.length-R.text.length)+O.text;break}else if(h?.type==="list"){let R=h,f=R.raw+`
`+n.join(`
`),O=this.list(f);s[s.length-1]=O,r=r.substring(0,r.length-h.raw.length)+O.raw,i=i.substring(0,i.length-R.raw.length)+O.raw,n=f.substring(s.at(-1).raw.length).split(`
`);continue}}return {type:"blockquote",raw:r,tokens:s,text:i}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),r=n.length>1,i={type:"list",raw:"",ordered:r,start:r?+n.slice(0,-1):"",loose:false,items:[]};n=r?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=r?n:"[*+-]");let s=this.rules.other.listItemRegex(n),a=false;for(;e;){let l=false,p="",c="";if(!(t=s.exec(e))||this.rules.block.hr.test(e))break;p=t[0],e=e.substring(p.length);let g=t[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,O=>" ".repeat(3*O.length)),h=e.split(`
`,1)[0],R=!g.trim(),f=0;if(this.options.pedantic?(f=2,c=g.trimStart()):R?f=t[1].length+1:(f=t[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,c=g.slice(f),f+=t[1].length),R&&this.rules.other.blankLine.test(h)&&(p+=h+`
`,e=e.substring(h.length+1),l=true),!l){let O=this.rules.other.nextBulletRegex(f),V=this.rules.other.hrRegex(f),Y=this.rules.other.fencesBeginRegex(f),ee=this.rules.other.headingBeginRegex(f),fe=this.rules.other.htmlBeginRegex(f);for(;e;){let H=e.split(`
`,1)[0],A;if(h=H,this.options.pedantic?(h=h.replace(this.rules.other.listReplaceNesting,"  "),A=h):A=h.replace(this.rules.other.tabCharGlobal,"    "),Y.test(h)||ee.test(h)||fe.test(h)||O.test(h)||V.test(h))break;if(A.search(this.rules.other.nonSpaceChar)>=f||!h.trim())c+=`
`+A.slice(f);else {if(R||g.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||Y.test(g)||ee.test(g)||V.test(g))break;c+=`
`+h;}!R&&!h.trim()&&(R=true),p+=H+`
`,e=e.substring(H.length+1),g=A.slice(f);}}i.loose||(a?i.loose=true:this.rules.other.doubleBlankLine.test(p)&&(a=true)),i.items.push({type:"list_item",raw:p,task:!!this.options.gfm&&this.rules.other.listIsTask.test(c),loose:false,text:c,tokens:[]}),i.raw+=p;}let o=i.items.at(-1);if(o)o.raw=o.raw.trimEnd(),o.text=o.text.trimEnd();else return;i.raw=i.raw.trimEnd();for(let l of i.items){if(this.lexer.state.top=false,l.tokens=this.lexer.blockTokens(l.text,[]),l.task){if(l.text=l.text.replace(this.rules.other.listReplaceTask,""),l.tokens[0]?.type==="text"||l.tokens[0]?.type==="paragraph"){l.tokens[0].raw=l.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),l.tokens[0].text=l.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let c=this.lexer.inlineQueue.length-1;c>=0;c--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)){this.lexer.inlineQueue[c].src=this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask,"");break}}let p=this.rules.other.listTaskCheckbox.exec(l.raw);if(p){let c={type:"checkbox",raw:p[0]+" ",checked:p[0]!=="[ ]"};l.checked=c.checked,i.loose?l.tokens[0]&&["paragraph","text"].includes(l.tokens[0].type)&&"tokens"in l.tokens[0]&&l.tokens[0].tokens?(l.tokens[0].raw=c.raw+l.tokens[0].raw,l.tokens[0].text=c.raw+l.tokens[0].text,l.tokens[0].tokens.unshift(c)):l.tokens.unshift({type:"paragraph",raw:c.raw,text:c.raw,tokens:[c]}):l.tokens.unshift(c);}}if(!i.loose){let p=l.tokens.filter(g=>g.type==="space"),c=p.length>0&&p.some(g=>this.rules.other.anyLine.test(g.raw));i.loose=c;}}if(i.loose)for(let l of i.items){l.loose=true;for(let p of l.tokens)p.type==="text"&&(p.type="paragraph");}return i}}html(e){let t=this.rules.block.html.exec(e);if(t)return {type:"html",block:true,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",i=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return {type:"def",tag:n,raw:t[0],href:r,title:i}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=J(t[1]),r=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),i=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],s={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===r.length){for(let a of r)this.rules.other.tableAlignRight.test(a)?s.align.push("right"):this.rules.other.tableAlignCenter.test(a)?s.align.push("center"):this.rules.other.tableAlignLeft.test(a)?s.align.push("left"):s.align.push(null);for(let a=0;a<n.length;a++)s.header.push({text:n[a],tokens:this.lexer.inline(n[a]),header:true,align:s.align[a]});for(let a of i)s.rows.push(J(a,s.header.length).map((o,l)=>({text:o,tokens:this.lexer.inline(o),header:false,align:s.align[l]})));return s}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t)return {type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===`
`?t[1].slice(0,-1):t[1];return {type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return {type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return {type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return !this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=true:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=false),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=true:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=false),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:false,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let s=z(n.slice(0,-1),"\\");if((n.length-s.length)%2===0)return}else {let s=de(t[2],"()");if(s===-2)return;if(s>-1){let o=(t[0].indexOf("!")===0?5:4)+t[1].length+s;t[2]=t[2].substring(0,s),t[0]=t[0].substring(0,o).trim(),t[3]="";}}let r=t[2],i="";if(this.options.pedantic){let s=this.rules.other.pedanticHrefTitle.exec(r);s&&(r=s[1],i=s[3]);}else i=t[3]?t[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?r=r.slice(1):r=r.slice(1,-1)),ge(t,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:i&&i.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let r=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),i=t[r.toLowerCase()];if(!i){let s=n[0].charAt(0);return {type:"text",raw:s,text:s}}return ge(n,i,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let r=this.rules.inline.emStrongLDelim.exec(e);if(!r||r[3]&&n.match(this.rules.other.unicodeAlphaNumeric))return;if(!(r[1]||r[2]||"")||!n||this.rules.inline.punctuation.exec(n)){let s=[...r[0]].length-1,a,o,l=s,p=0,c=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,t=t.slice(-1*e.length+s);(r=c.exec(t))!=null;){if(a=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!a)continue;if(o=[...a].length,r[3]||r[4]){l+=o;continue}else if((r[5]||r[6])&&s%3&&!((s+o)%3)){p+=o;continue}if(l-=o,l>0)continue;o=Math.min(o,o+l+p);let g=[...r[0]][0].length,h=e.slice(0,s+r.index+g+o);if(Math.min(s,o)%2){let f=h.slice(1,-1);return {type:"em",raw:h,text:f,tokens:this.lexer.inlineTokens(f)}}let R=h.slice(2,-2);return {type:"strong",raw:h,text:R,tokens:this.lexer.inlineTokens(R)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),r=this.rules.other.nonSpaceChar.test(n),i=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return r&&i&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return {type:"br",raw:t[0]}}del(e){let t=this.rules.inline.del.exec(e);if(t)return {type:"del",raw:t[0],text:t[2],tokens:this.lexer.inlineTokens(t[2])}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,r;return t[2]==="@"?(n=t[1],r="mailto:"+n):(n=t[1],r=n),{type:"link",raw:t[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,r;if(t[2]==="@")n=t[0],r="mailto:"+n;else {let i;do i=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(i!==t[0]);n=t[0],t[1]==="www."?r="http://"+t[0]:r=t[0];}return {type:"link",raw:t[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return {type:"text",raw:t[0],text:t[0],escaped:n}}}};var x=class u{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||T,this.options.tokenizer=this.options.tokenizer||new y,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:false,inRawBlock:false,top:true};let t={other:m,block:E.normal,inline:M.normal};this.options.pedantic?(t.block=E.pedantic,t.inline=M.pedantic):this.options.gfm&&(t.block=E.gfm,this.options.breaks?t.inline=M.breaks:t.inline=M.gfm),this.tokenizer.rules=t;}static get rules(){return {block:E,inline:M}}static lex(e,t){return new u(t).lex(e)}static lexInline(e,t){return new u(t).inlineTokens(e)}lex(e){e=e.replace(m.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){let n=this.inlineQueue[t];this.inlineTokens(n.src,n.tokens);}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],n=false){for(this.options.pedantic&&(e=e.replace(m.tabCharGlobal,"    ").replace(m.spaceLine,""));e;){let r;if(this.options.extensions?.block?.some(s=>(r=s.call({lexer:this},e,t))?(e=e.substring(r.raw.length),t.push(r),true):false))continue;if(r=this.tokenizer.space(e)){e=e.substring(r.raw.length);let s=t.at(-1);r.raw.length===1&&s!==void 0?s.raw+=`
`:t.push(r);continue}if(r=this.tokenizer.code(e)){e=e.substring(r.raw.length);let s=t.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.text,this.inlineQueue.at(-1).src=s.text):t.push(r);continue}if(r=this.tokenizer.fences(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.heading(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.hr(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.blockquote(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.list(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.html(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.def(e)){e=e.substring(r.raw.length);let s=t.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.raw,this.inlineQueue.at(-1).src=s.text):this.tokens.links[r.tag]||(this.tokens.links[r.tag]={href:r.href,title:r.title},t.push(r));continue}if(r=this.tokenizer.table(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.lheading(e)){e=e.substring(r.raw.length),t.push(r);continue}let i=e;if(this.options.extensions?.startBlock){let s=1/0,a=e.slice(1),o;this.options.extensions.startBlock.forEach(l=>{o=l.call({lexer:this},a),typeof o=="number"&&o>=0&&(s=Math.min(s,o));}),s<1/0&&s>=0&&(i=e.substring(0,s+1));}if(this.state.top&&(r=this.tokenizer.paragraph(i))){let s=t.at(-1);n&&s?.type==="paragraph"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):t.push(r),n=i.length!==e.length,e=e.substring(r.raw.length);continue}if(r=this.tokenizer.text(e)){e=e.substring(r.raw.length);let s=t.at(-1);s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):t.push(r);continue}if(e){let s="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(s);break}else throw new Error(s)}}return this.state.top=true,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let n=e,r=null;if(this.tokens.links){let o=Object.keys(this.tokens.links);if(o.length>0)for(;(r=this.tokenizer.rules.inline.reflinkSearch.exec(n))!=null;)o.includes(r[0].slice(r[0].lastIndexOf("[")+1,-1))&&(n=n.slice(0,r.index)+"["+"a".repeat(r[0].length-2)+"]"+n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));}for(;(r=this.tokenizer.rules.inline.anyPunctuation.exec(n))!=null;)n=n.slice(0,r.index)+"++"+n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let i;for(;(r=this.tokenizer.rules.inline.blockSkip.exec(n))!=null;)i=r[2]?r[2].length:0,n=n.slice(0,r.index+i)+"["+"a".repeat(r[0].length-i-2)+"]"+n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);n=this.options.hooks?.emStrongMask?.call({lexer:this},n)??n;let s=false,a="";for(;e;){s||(a=""),s=false;let o;if(this.options.extensions?.inline?.some(p=>(o=p.call({lexer:this},e,t))?(e=e.substring(o.raw.length),t.push(o),true):false))continue;if(o=this.tokenizer.escape(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.tag(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.link(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(o.raw.length);let p=t.at(-1);o.type==="text"&&p?.type==="text"?(p.raw+=o.raw,p.text+=o.text):t.push(o);continue}if(o=this.tokenizer.emStrong(e,n,a)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.codespan(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.br(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.del(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.autolink(e)){e=e.substring(o.raw.length),t.push(o);continue}if(!this.state.inLink&&(o=this.tokenizer.url(e))){e=e.substring(o.raw.length),t.push(o);continue}let l=e;if(this.options.extensions?.startInline){let p=1/0,c=e.slice(1),g;this.options.extensions.startInline.forEach(h=>{g=h.call({lexer:this},c),typeof g=="number"&&g>=0&&(p=Math.min(p,g));}),p<1/0&&p>=0&&(l=e.substring(0,p+1));}if(o=this.tokenizer.inlineText(l)){e=e.substring(o.raw.length),o.raw.slice(-1)!=="_"&&(a=o.raw.slice(-1)),s=true;let p=t.at(-1);p?.type==="text"?(p.raw+=o.raw,p.text+=o.text):t.push(o);continue}if(e){let p="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(p);break}else throw new Error(p)}}return t}};var P=class{options;parser;constructor(e){this.options=e||T;}space(e){return ""}code({text:e,lang:t,escaped:n}){let r=(t||"").match(m.notSpaceStart)?.[0],i=e.replace(m.endingNewline,"")+`
`;return r?'<pre><code class="language-'+w(r)+'">'+(n?i:w(i,true))+`</code></pre>
`:"<pre><code>"+(n?i:w(i,true))+`</code></pre>
`}blockquote({tokens:e}){return `<blockquote>
${this.parser.parse(e)}</blockquote>
`}html({text:e}){return e}def(e){return ""}heading({tokens:e,depth:t}){return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`}hr(e){return `<hr>
`}list(e){let t=e.ordered,n=e.start,r="";for(let a=0;a<e.items.length;a++){let o=e.items[a];r+=this.listitem(o);}let i=t?"ol":"ul",s=t&&n!==1?' start="'+n+'"':"";return "<"+i+s+`>
`+r+"</"+i+`>
`}listitem(e){return `<li>${this.parser.parse(e.tokens)}</li>
`}checkbox({checked:e}){return "<input "+(e?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:e}){return `<p>${this.parser.parseInline(e)}</p>
`}table(e){let t="",n="";for(let i=0;i<e.header.length;i++)n+=this.tablecell(e.header[i]);t+=this.tablerow({text:n});let r="";for(let i=0;i<e.rows.length;i++){let s=e.rows[i];n="";for(let a=0;a<s.length;a++)n+=this.tablecell(s[a]);r+=this.tablerow({text:n});}return r&&(r=`<tbody>${r}</tbody>`),`<table>
<thead>
`+t+`</thead>
`+r+`</table>
`}tablerow({text:e}){return `<tr>
${e}</tr>
`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?"th":"td";return (e.align?`<${n} align="${e.align}">`:`<${n}>`)+t+`</${n}>
`}strong({tokens:e}){return `<strong>${this.parser.parseInline(e)}</strong>`}em({tokens:e}){return `<em>${this.parser.parseInline(e)}</em>`}codespan({text:e}){return `<code>${w(e,true)}</code>`}br(e){return "<br>"}del({tokens:e}){return `<del>${this.parser.parseInline(e)}</del>`}link({href:e,title:t,tokens:n}){let r=this.parser.parseInline(n),i=X(e);if(i===null)return r;e=i;let s='<a href="'+e+'"';return t&&(s+=' title="'+w(t)+'"'),s+=">"+r+"</a>",s}image({href:e,title:t,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));let i=X(e);if(i===null)return w(n);e=i;let s=`<img src="${e}" alt="${n}"`;return t&&(s+=` title="${w(t)}"`),s+=">",s}text(e){return "tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:w(e.text)}};var $=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return ""+e}image({text:e}){return ""+e}br(){return ""}checkbox({raw:e}){return e}};var b=class u{options;renderer;textRenderer;constructor(e){this.options=e||T,this.options.renderer=this.options.renderer||new P,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new $;}static parse(e,t){return new u(t).parse(e)}static parseInline(e,t){return new u(t).parseInline(e)}parse(e){let t="";for(let n=0;n<e.length;n++){let r=e[n];if(this.options.extensions?.renderers?.[r.type]){let s=r,a=this.options.extensions.renderers[s.type].call({parser:this},s);if(a!==false||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(s.type)){t+=a||"";continue}}let i=r;switch(i.type){case "space":{t+=this.renderer.space(i);break}case "hr":{t+=this.renderer.hr(i);break}case "heading":{t+=this.renderer.heading(i);break}case "code":{t+=this.renderer.code(i);break}case "table":{t+=this.renderer.table(i);break}case "blockquote":{t+=this.renderer.blockquote(i);break}case "list":{t+=this.renderer.list(i);break}case "checkbox":{t+=this.renderer.checkbox(i);break}case "html":{t+=this.renderer.html(i);break}case "def":{t+=this.renderer.def(i);break}case "paragraph":{t+=this.renderer.paragraph(i);break}case "text":{t+=this.renderer.text(i);break}default:{let s='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(s),"";throw new Error(s)}}}return t}parseInline(e,t=this.renderer){let n="";for(let r=0;r<e.length;r++){let i=e[r];if(this.options.extensions?.renderers?.[i.type]){let a=this.options.extensions.renderers[i.type].call({parser:this},i);if(a!==false||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(i.type)){n+=a||"";continue}}let s=i;switch(s.type){case "escape":{n+=t.text(s);break}case "html":{n+=t.html(s);break}case "link":{n+=t.link(s);break}case "image":{n+=t.image(s);break}case "checkbox":{n+=t.checkbox(s);break}case "strong":{n+=t.strong(s);break}case "em":{n+=t.em(s);break}case "codespan":{n+=t.codespan(s);break}case "br":{n+=t.br(s);break}case "del":{n+=t.del(s);break}case "text":{n+=t.text(s);break}default:{let a='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return n}};var S=class{options;block;constructor(e){this.options=e||T;}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(){return this.block?x.lex:x.lexInline}provideParser(){return this.block?b.parse:b.parseInline}};var B=class{defaults=L();options=this.setOptions;parse=this.parseMarkdown(true);parseInline=this.parseMarkdown(false);Parser=b;Renderer=P;TextRenderer=$;Lexer=x;Tokenizer=y;Hooks=S;constructor(...e){this.use(...e);}walkTokens(e,t){let n=[];for(let r of e)switch(n=n.concat(t.call(this,r)),r.type){case "table":{let i=r;for(let s of i.header)n=n.concat(this.walkTokens(s.tokens,t));for(let s of i.rows)for(let a of s)n=n.concat(this.walkTokens(a.tokens,t));break}case "list":{let i=r;n=n.concat(this.walkTokens(i.items,t));break}default:{let i=r;this.defaults.extensions?.childTokens?.[i.type]?this.defaults.extensions.childTokens[i.type].forEach(s=>{let a=i[s].flat(1/0);n=n.concat(this.walkTokens(a,t));}):i.tokens&&(n=n.concat(this.walkTokens(i.tokens,t)));}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let r={...n};if(r.async=this.defaults.async||r.async||false,n.extensions&&(n.extensions.forEach(i=>{if(!i.name)throw new Error("extension name required");if("renderer"in i){let s=t.renderers[i.name];s?t.renderers[i.name]=function(...a){let o=i.renderer.apply(this,a);return o===false&&(o=s.apply(this,a)),o}:t.renderers[i.name]=i.renderer;}if("tokenizer"in i){if(!i.level||i.level!=="block"&&i.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let s=t[i.level];s?s.unshift(i.tokenizer):t[i.level]=[i.tokenizer],i.start&&(i.level==="block"?t.startBlock?t.startBlock.push(i.start):t.startBlock=[i.start]:i.level==="inline"&&(t.startInline?t.startInline.push(i.start):t.startInline=[i.start]));}"childTokens"in i&&i.childTokens&&(t.childTokens[i.name]=i.childTokens);}),r.extensions=t),n.renderer){let i=this.defaults.renderer||new P(this.defaults);for(let s in n.renderer){if(!(s in i))throw new Error(`renderer '${s}' does not exist`);if(["options","parser"].includes(s))continue;let a=s,o=n.renderer[a],l=i[a];i[a]=(...p)=>{let c=o.apply(i,p);return c===false&&(c=l.apply(i,p)),c||""};}r.renderer=i;}if(n.tokenizer){let i=this.defaults.tokenizer||new y(this.defaults);for(let s in n.tokenizer){if(!(s in i))throw new Error(`tokenizer '${s}' does not exist`);if(["options","rules","lexer"].includes(s))continue;let a=s,o=n.tokenizer[a],l=i[a];i[a]=(...p)=>{let c=o.apply(i,p);return c===false&&(c=l.apply(i,p)),c};}r.tokenizer=i;}if(n.hooks){let i=this.defaults.hooks||new S;for(let s in n.hooks){if(!(s in i))throw new Error(`hook '${s}' does not exist`);if(["options","block"].includes(s))continue;let a=s,o=n.hooks[a],l=i[a];S.passThroughHooks.has(s)?i[a]=p=>{if(this.defaults.async&&S.passThroughHooksRespectAsync.has(s))return (async()=>{let g=await o.call(i,p);return l.call(i,g)})();let c=o.call(i,p);return l.call(i,c)}:i[a]=(...p)=>{if(this.defaults.async)return (async()=>{let g=await o.apply(i,p);return g===false&&(g=await l.apply(i,p)),g})();let c=o.apply(i,p);return c===false&&(c=l.apply(i,p)),c};}r.hooks=i;}if(n.walkTokens){let i=this.defaults.walkTokens,s=n.walkTokens;r.walkTokens=function(a){let o=[];return o.push(s.call(this,a)),i&&(o=o.concat(i.call(this,a))),o};}this.defaults={...this.defaults,...r};}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return x.lex(e,t??this.defaults)}parser(e,t){return b.parse(e,t??this.defaults)}parseMarkdown(e){return (n,r)=>{let i={...r},s={...this.defaults,...i},a=this.onError(!!s.silent,!!s.async);if(this.defaults.async===true&&i.async===false)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof n>"u"||n===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof n!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(n)+", string expected"));if(s.hooks&&(s.hooks.options=s,s.hooks.block=e),s.async)return (async()=>{let o=s.hooks?await s.hooks.preprocess(n):n,p=await(s.hooks?await s.hooks.provideLexer():e?x.lex:x.lexInline)(o,s),c=s.hooks?await s.hooks.processAllTokens(p):p;s.walkTokens&&await Promise.all(this.walkTokens(c,s.walkTokens));let h=await(s.hooks?await s.hooks.provideParser():e?b.parse:b.parseInline)(c,s);return s.hooks?await s.hooks.postprocess(h):h})().catch(a);try{s.hooks&&(n=s.hooks.preprocess(n));let l=(s.hooks?s.hooks.provideLexer():e?x.lex:x.lexInline)(n,s);s.hooks&&(l=s.hooks.processAllTokens(l)),s.walkTokens&&this.walkTokens(l,s.walkTokens);let c=(s.hooks?s.hooks.provideParser():e?b.parse:b.parseInline)(l,s);return s.hooks&&(c=s.hooks.postprocess(c)),c}catch(o){return a(o)}}}onError(e,t){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,e){let r="<p>An error occurred:</p><pre>"+w(n.message+"",true)+"</pre>";return t?Promise.resolve(r):r}if(t)return Promise.reject(n);throw n}}};var _=new B;function d(u,e){return _.parse(u,e)}d.options=d.setOptions=function(u){return _.setOptions(u),d.defaults=_.defaults,Z(d.defaults),d};d.getDefaults=L;d.defaults=T;d.use=function(...u){return _.use(...u),d.defaults=_.defaults,Z(d.defaults),d};d.walkTokens=function(u,e){return _.walkTokens(u,e)};d.parseInline=_.parseInline;d.Parser=b;d.parser=b.parse;d.Renderer=P;d.TextRenderer=$;d.Lexer=x;d.lexer=x.lex;d.Tokenizer=y;d.Hooks=S;d.parse=d;d.options;d.setOptions;d.use;d.walkTokens;d.parseInline;b.parse;x.lex;

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

/* eslint-disable no-multi-assign */

var core;
var hasRequiredCore;

function requireCore () {
	if (hasRequiredCore) return core;
	hasRequiredCore = 1;
	function deepFreeze(obj) {
	  if (obj instanceof Map) {
	    obj.clear =
	      obj.delete =
	      obj.set =
	        function () {
	          throw new Error('map is read-only');
	        };
	  } else if (obj instanceof Set) {
	    obj.add =
	      obj.clear =
	      obj.delete =
	        function () {
	          throw new Error('set is read-only');
	        };
	  }

	  // Freeze self
	  Object.freeze(obj);

	  Object.getOwnPropertyNames(obj).forEach((name) => {
	    const prop = obj[name];
	    const type = typeof prop;

	    // Freeze prop if it is an object or function and also not already frozen
	    if ((type === 'object' || type === 'function') && !Object.isFrozen(prop)) {
	      deepFreeze(prop);
	    }
	  });

	  return obj;
	}

	/** @typedef {import('highlight.js').CallbackResponse} CallbackResponse */
	/** @typedef {import('highlight.js').CompiledMode} CompiledMode */
	/** @implements CallbackResponse */

	class Response {
	  /**
	   * @param {CompiledMode} mode
	   */
	  constructor(mode) {
	    // eslint-disable-next-line no-undefined
	    if (mode.data === undefined) mode.data = {};

	    this.data = mode.data;
	    this.isMatchIgnored = false;
	  }

	  ignoreMatch() {
	    this.isMatchIgnored = true;
	  }
	}

	/**
	 * @param {string} value
	 * @returns {string}
	 */
	function escapeHTML(value) {
	  return value
	    .replace(/&/g, '&amp;')
	    .replace(/</g, '&lt;')
	    .replace(/>/g, '&gt;')
	    .replace(/"/g, '&quot;')
	    .replace(/'/g, '&#x27;');
	}

	/**
	 * performs a shallow merge of multiple objects into one
	 *
	 * @template T
	 * @param {T} original
	 * @param {Record<string,any>[]} objects
	 * @returns {T} a single new object
	 */
	function inherit$1(original, ...objects) {
	  /** @type Record<string,any> */
	  const result = Object.create(null);

	  for (const key in original) {
	    result[key] = original[key];
	  }
	  objects.forEach(function(obj) {
	    for (const key in obj) {
	      result[key] = obj[key];
	    }
	  });
	  return /** @type {T} */ (result);
	}

	/**
	 * @typedef {object} Renderer
	 * @property {(text: string) => void} addText
	 * @property {(node: Node) => void} openNode
	 * @property {(node: Node) => void} closeNode
	 * @property {() => string} value
	 */

	/** @typedef {{scope?: string, language?: string, sublanguage?: boolean}} Node */
	/** @typedef {{walk: (r: Renderer) => void}} Tree */
	/** */

	const SPAN_CLOSE = '</span>';

	/**
	 * Determines if a node needs to be wrapped in <span>
	 *
	 * @param {Node} node */
	const emitsWrappingTags = (node) => {
	  // rarely we can have a sublanguage where language is undefined
	  // TODO: track down why
	  return !!node.scope;
	};

	/**
	 *
	 * @param {string} name
	 * @param {{prefix:string}} options
	 */
	const scopeToCSSClass = (name, { prefix }) => {
	  // sub-language
	  if (name.startsWith("language:")) {
	    return name.replace("language:", "language-");
	  }
	  // tiered scope: comment.line
	  if (name.includes(".")) {
	    const pieces = name.split(".");
	    return [
	      `${prefix}${pieces.shift()}`,
	      ...(pieces.map((x, i) => `${x}${"_".repeat(i + 1)}`))
	    ].join(" ");
	  }
	  // simple scope
	  return `${prefix}${name}`;
	};

	/** @type {Renderer} */
	class HTMLRenderer {
	  /**
	   * Creates a new HTMLRenderer
	   *
	   * @param {Tree} parseTree - the parse tree (must support `walk` API)
	   * @param {{classPrefix: string}} options
	   */
	  constructor(parseTree, options) {
	    this.buffer = "";
	    this.classPrefix = options.classPrefix;
	    parseTree.walk(this);
	  }

	  /**
	   * Adds texts to the output stream
	   *
	   * @param {string} text */
	  addText(text) {
	    this.buffer += escapeHTML(text);
	  }

	  /**
	   * Adds a node open to the output stream (if needed)
	   *
	   * @param {Node} node */
	  openNode(node) {
	    if (!emitsWrappingTags(node)) return;

	    const className = scopeToCSSClass(node.scope,
	      { prefix: this.classPrefix });
	    this.span(className);
	  }

	  /**
	   * Adds a node close to the output stream (if needed)
	   *
	   * @param {Node} node */
	  closeNode(node) {
	    if (!emitsWrappingTags(node)) return;

	    this.buffer += SPAN_CLOSE;
	  }

	  /**
	   * returns the accumulated buffer
	  */
	  value() {
	    return this.buffer;
	  }

	  // helpers

	  /**
	   * Builds a span element
	   *
	   * @param {string} className */
	  span(className) {
	    this.buffer += `<span class="${className}">`;
	  }
	}

	/** @typedef {{scope?: string, language?: string, children: Node[]} | string} Node */
	/** @typedef {{scope?: string, language?: string, children: Node[]} } DataNode */
	/** @typedef {import('highlight.js').Emitter} Emitter */
	/**  */

	/** @returns {DataNode} */
	const newNode = (opts = {}) => {
	  /** @type DataNode */
	  const result = { children: [] };
	  Object.assign(result, opts);
	  return result;
	};

	class TokenTree {
	  constructor() {
	    /** @type DataNode */
	    this.rootNode = newNode();
	    this.stack = [this.rootNode];
	  }

	  get top() {
	    return this.stack[this.stack.length - 1];
	  }

	  get root() { return this.rootNode; }

	  /** @param {Node} node */
	  add(node) {
	    this.top.children.push(node);
	  }

	  /** @param {string} scope */
	  openNode(scope) {
	    /** @type Node */
	    const node = newNode({ scope });
	    this.add(node);
	    this.stack.push(node);
	  }

	  closeNode() {
	    if (this.stack.length > 1) {
	      return this.stack.pop();
	    }
	    // eslint-disable-next-line no-undefined
	    return undefined;
	  }

	  closeAllNodes() {
	    while (this.closeNode());
	  }

	  toJSON() {
	    return JSON.stringify(this.rootNode, null, 4);
	  }

	  /**
	   * @typedef { import("./html_renderer").Renderer } Renderer
	   * @param {Renderer} builder
	   */
	  walk(builder) {
	    // this does not
	    return this.constructor._walk(builder, this.rootNode);
	    // this works
	    // return TokenTree._walk(builder, this.rootNode);
	  }

	  /**
	   * @param {Renderer} builder
	   * @param {Node} node
	   */
	  static _walk(builder, node) {
	    if (typeof node === "string") {
	      builder.addText(node);
	    } else if (node.children) {
	      builder.openNode(node);
	      node.children.forEach((child) => this._walk(builder, child));
	      builder.closeNode(node);
	    }
	    return builder;
	  }

	  /**
	   * @param {Node} node
	   */
	  static _collapse(node) {
	    if (typeof node === "string") return;
	    if (!node.children) return;

	    if (node.children.every(el => typeof el === "string")) {
	      // node.text = node.children.join("");
	      // delete node.children;
	      node.children = [node.children.join("")];
	    } else {
	      node.children.forEach((child) => {
	        TokenTree._collapse(child);
	      });
	    }
	  }
	}

	/**
	  Currently this is all private API, but this is the minimal API necessary
	  that an Emitter must implement to fully support the parser.

	  Minimal interface:

	  - addText(text)
	  - __addSublanguage(emitter, subLanguageName)
	  - startScope(scope)
	  - endScope()
	  - finalize()
	  - toHTML()

	*/

	/**
	 * @implements {Emitter}
	 */
	class TokenTreeEmitter extends TokenTree {
	  /**
	   * @param {*} options
	   */
	  constructor(options) {
	    super();
	    this.options = options;
	  }

	  /**
	   * @param {string} text
	   */
	  addText(text) {
	    if (text === "") { return; }

	    this.add(text);
	  }

	  /** @param {string} scope */
	  startScope(scope) {
	    this.openNode(scope);
	  }

	  endScope() {
	    this.closeNode();
	  }

	  /**
	   * @param {Emitter & {root: DataNode}} emitter
	   * @param {string} name
	   */
	  __addSublanguage(emitter, name) {
	    /** @type DataNode */
	    const node = emitter.root;
	    if (name) node.scope = `language:${name}`;

	    this.add(node);
	  }

	  toHTML() {
	    const renderer = new HTMLRenderer(this, this.options);
	    return renderer.value();
	  }

	  finalize() {
	    this.closeAllNodes();
	    return true;
	  }
	}

	/**
	 * @param {string} value
	 * @returns {RegExp}
	 * */

	/**
	 * @param {RegExp | string } re
	 * @returns {string}
	 */
	function source(re) {
	  if (!re) return null;
	  if (typeof re === "string") return re;

	  return re.source;
	}

	/**
	 * @param {RegExp | string } re
	 * @returns {string}
	 */
	function lookahead(re) {
	  return concat('(?=', re, ')');
	}

	/**
	 * @param {RegExp | string } re
	 * @returns {string}
	 */
	function anyNumberOfTimes(re) {
	  return concat('(?:', re, ')*');
	}

	/**
	 * @param {RegExp | string } re
	 * @returns {string}
	 */
	function optional(re) {
	  return concat('(?:', re, ')?');
	}

	/**
	 * @param {...(RegExp | string) } args
	 * @returns {string}
	 */
	function concat(...args) {
	  const joined = args.map((x) => source(x)).join("");
	  return joined;
	}

	/**
	 * @param { Array<string | RegExp | Object> } args
	 * @returns {object}
	 */
	function stripOptionsFromArgs(args) {
	  const opts = args[args.length - 1];

	  if (typeof opts === 'object' && opts.constructor === Object) {
	    args.splice(args.length - 1, 1);
	    return opts;
	  } else {
	    return {};
	  }
	}

	/** @typedef { {capture?: boolean} } RegexEitherOptions */

	/**
	 * Any of the passed expresssions may match
	 *
	 * Creates a huge this | this | that | that match
	 * @param {(RegExp | string)[] | [...(RegExp | string)[], RegexEitherOptions]} args
	 * @returns {string}
	 */
	function either(...args) {
	  /** @type { object & {capture?: boolean} }  */
	  const opts = stripOptionsFromArgs(args);
	  const joined = '('
	    + (opts.capture ? "" : "?:")
	    + args.map((x) => source(x)).join("|") + ")";
	  return joined;
	}

	/**
	 * @param {RegExp | string} re
	 * @returns {number}
	 */
	function countMatchGroups(re) {
	  return (new RegExp(re.toString() + '|')).exec('').length - 1;
	}

	/**
	 * Does lexeme start with a regular expression match at the beginning
	 * @param {RegExp} re
	 * @param {string} lexeme
	 */
	function startsWith(re, lexeme) {
	  const match = re && re.exec(lexeme);
	  return match && match.index === 0;
	}

	// BACKREF_RE matches an open parenthesis or backreference. To avoid
	// an incorrect parse, it additionally matches the following:
	// - [...] elements, where the meaning of parentheses and escapes change
	// - other escape sequences, so we do not misparse escape sequences as
	//   interesting elements
	// - non-matching or lookahead parentheses, which do not capture. These
	//   follow the '(' with a '?'.
	const BACKREF_RE = /\[(?:[^\\\]]|\\.)*\]|\(\??|\\([1-9][0-9]*)|\\./;

	// **INTERNAL** Not intended for outside usage
	// join logically computes regexps.join(separator), but fixes the
	// backreferences so they continue to match.
	// it also places each individual regular expression into it's own
	// match group, keeping track of the sequencing of those match groups
	// is currently an exercise for the caller. :-)
	/**
	 * @param {(string | RegExp)[]} regexps
	 * @param {{joinWith: string}} opts
	 * @returns {string}
	 */
	function _rewriteBackreferences(regexps, { joinWith }) {
	  let numCaptures = 0;

	  return regexps.map((regex) => {
	    numCaptures += 1;
	    const offset = numCaptures;
	    let re = source(regex);
	    let out = '';

	    while (re.length > 0) {
	      const match = BACKREF_RE.exec(re);
	      if (!match) {
	        out += re;
	        break;
	      }
	      out += re.substring(0, match.index);
	      re = re.substring(match.index + match[0].length);
	      if (match[0][0] === '\\' && match[1]) {
	        // Adjust the backreference.
	        out += '\\' + String(Number(match[1]) + offset);
	      } else {
	        out += match[0];
	        if (match[0] === '(') {
	          numCaptures++;
	        }
	      }
	    }
	    return out;
	  }).map(re => `(${re})`).join(joinWith);
	}

	/** @typedef {import('highlight.js').Mode} Mode */
	/** @typedef {import('highlight.js').ModeCallback} ModeCallback */

	// Common regexps
	const MATCH_NOTHING_RE = /\b\B/;
	const IDENT_RE = '[a-zA-Z]\\w*';
	const UNDERSCORE_IDENT_RE = '[a-zA-Z_]\\w*';
	const NUMBER_RE = '\\b\\d+(\\.\\d+)?';
	const C_NUMBER_RE = '(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)'; // 0x..., 0..., decimal, float
	const BINARY_NUMBER_RE = '\\b(0b[01]+)'; // 0b...
	const RE_STARTERS_RE = '!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~';

	/**
	* @param { Partial<Mode> & {binary?: string | RegExp} } opts
	*/
	const SHEBANG = (opts = {}) => {
	  const beginShebang = /^#![ ]*\//;
	  if (opts.binary) {
	    opts.begin = concat(
	      beginShebang,
	      /.*\b/,
	      opts.binary,
	      /\b.*/);
	  }
	  return inherit$1({
	    scope: 'meta',
	    begin: beginShebang,
	    end: /$/,
	    relevance: 0,
	    /** @type {ModeCallback} */
	    "on:begin": (m, resp) => {
	      if (m.index !== 0) resp.ignoreMatch();
	    }
	  }, opts);
	};

	// Common modes
	const BACKSLASH_ESCAPE = {
	  begin: '\\\\[\\s\\S]', relevance: 0
	};
	const APOS_STRING_MODE = {
	  scope: 'string',
	  begin: '\'',
	  end: '\'',
	  illegal: '\\n',
	  contains: [BACKSLASH_ESCAPE]
	};
	const QUOTE_STRING_MODE = {
	  scope: 'string',
	  begin: '"',
	  end: '"',
	  illegal: '\\n',
	  contains: [BACKSLASH_ESCAPE]
	};
	const PHRASAL_WORDS_MODE = {
	  begin: /\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/
	};
	/**
	 * Creates a comment mode
	 *
	 * @param {string | RegExp} begin
	 * @param {string | RegExp} end
	 * @param {Mode | {}} [modeOptions]
	 * @returns {Partial<Mode>}
	 */
	const COMMENT = function(begin, end, modeOptions = {}) {
	  const mode = inherit$1(
	    {
	      scope: 'comment',
	      begin,
	      end,
	      contains: []
	    },
	    modeOptions
	  );
	  mode.contains.push({
	    scope: 'doctag',
	    // hack to avoid the space from being included. the space is necessary to
	    // match here to prevent the plain text rule below from gobbling up doctags
	    begin: '[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)',
	    end: /(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,
	    excludeBegin: true,
	    relevance: 0
	  });
	  const ENGLISH_WORD = either(
	    // list of common 1 and 2 letter words in English
	    "I",
	    "a",
	    "is",
	    "so",
	    "us",
	    "to",
	    "at",
	    "if",
	    "in",
	    "it",
	    "on",
	    // note: this is not an exhaustive list of contractions, just popular ones
	    /[A-Za-z]+['](d|ve|re|ll|t|s|n)/, // contractions - can't we'd they're let's, etc
	    /[A-Za-z]+[-][a-z]+/, // `no-way`, etc.
	    /[A-Za-z][a-z]{2,}/ // allow capitalized words at beginning of sentences
	  );
	  // looking like plain text, more likely to be a comment
	  mode.contains.push(
	    {
	      // TODO: how to include ", (, ) without breaking grammars that use these for
	      // comment delimiters?
	      // begin: /[ ]+([()"]?([A-Za-z'-]{3,}|is|a|I|so|us|[tT][oO]|at|if|in|it|on)[.]?[()":]?([.][ ]|[ ]|\))){3}/
	      // ---

	      // this tries to find sequences of 3 english words in a row (without any
	      // "programming" type syntax) this gives us a strong signal that we've
	      // TRULY found a comment - vs perhaps scanning with the wrong language.
	      // It's possible to find something that LOOKS like the start of the
	      // comment - but then if there is no readable text - good chance it is a
	      // false match and not a comment.
	      //
	      // for a visual example please see:
	      // https://github.com/highlightjs/highlight.js/issues/2827

	      begin: concat(
	        /[ ]+/, // necessary to prevent us gobbling up doctags like /* @author Bob Mcgill */
	        '(',
	        ENGLISH_WORD,
	        /[.]?[:]?([.][ ]|[ ])/,
	        '){3}') // look for 3 words in a row
	    }
	  );
	  return mode;
	};
	const C_LINE_COMMENT_MODE = COMMENT('//', '$');
	const C_BLOCK_COMMENT_MODE = COMMENT('/\\*', '\\*/');
	const HASH_COMMENT_MODE = COMMENT('#', '$');
	const NUMBER_MODE = {
	  scope: 'number',
	  begin: NUMBER_RE,
	  relevance: 0
	};
	const C_NUMBER_MODE = {
	  scope: 'number',
	  begin: C_NUMBER_RE,
	  relevance: 0
	};
	const BINARY_NUMBER_MODE = {
	  scope: 'number',
	  begin: BINARY_NUMBER_RE,
	  relevance: 0
	};
	const REGEXP_MODE = {
	  scope: "regexp",
	  begin: /\/(?=[^/\n]*\/)/,
	  end: /\/[gimuy]*/,
	  contains: [
	    BACKSLASH_ESCAPE,
	    {
	      begin: /\[/,
	      end: /\]/,
	      relevance: 0,
	      contains: [BACKSLASH_ESCAPE]
	    }
	  ]
	};
	const TITLE_MODE = {
	  scope: 'title',
	  begin: IDENT_RE,
	  relevance: 0
	};
	const UNDERSCORE_TITLE_MODE = {
	  scope: 'title',
	  begin: UNDERSCORE_IDENT_RE,
	  relevance: 0
	};
	const METHOD_GUARD = {
	  // excludes method names from keyword processing
	  begin: '\\.\\s*' + UNDERSCORE_IDENT_RE,
	  relevance: 0
	};

	/**
	 * Adds end same as begin mechanics to a mode
	 *
	 * Your mode must include at least a single () match group as that first match
	 * group is what is used for comparison
	 * @param {Partial<Mode>} mode
	 */
	const END_SAME_AS_BEGIN = function(mode) {
	  return Object.assign(mode,
	    {
	      /** @type {ModeCallback} */
	      'on:begin': (m, resp) => { resp.data._beginMatch = m[1]; },
	      /** @type {ModeCallback} */
	      'on:end': (m, resp) => { if (resp.data._beginMatch !== m[1]) resp.ignoreMatch(); }
	    });
	};

	var MODES = /*#__PURE__*/Object.freeze({
	  __proto__: null,
	  APOS_STRING_MODE: APOS_STRING_MODE,
	  BACKSLASH_ESCAPE: BACKSLASH_ESCAPE,
	  BINARY_NUMBER_MODE: BINARY_NUMBER_MODE,
	  BINARY_NUMBER_RE: BINARY_NUMBER_RE,
	  COMMENT: COMMENT,
	  C_BLOCK_COMMENT_MODE: C_BLOCK_COMMENT_MODE,
	  C_LINE_COMMENT_MODE: C_LINE_COMMENT_MODE,
	  C_NUMBER_MODE: C_NUMBER_MODE,
	  C_NUMBER_RE: C_NUMBER_RE,
	  END_SAME_AS_BEGIN: END_SAME_AS_BEGIN,
	  HASH_COMMENT_MODE: HASH_COMMENT_MODE,
	  IDENT_RE: IDENT_RE,
	  MATCH_NOTHING_RE: MATCH_NOTHING_RE,
	  METHOD_GUARD: METHOD_GUARD,
	  NUMBER_MODE: NUMBER_MODE,
	  NUMBER_RE: NUMBER_RE,
	  PHRASAL_WORDS_MODE: PHRASAL_WORDS_MODE,
	  QUOTE_STRING_MODE: QUOTE_STRING_MODE,
	  REGEXP_MODE: REGEXP_MODE,
	  RE_STARTERS_RE: RE_STARTERS_RE,
	  SHEBANG: SHEBANG,
	  TITLE_MODE: TITLE_MODE,
	  UNDERSCORE_IDENT_RE: UNDERSCORE_IDENT_RE,
	  UNDERSCORE_TITLE_MODE: UNDERSCORE_TITLE_MODE
	});

	/**
	@typedef {import('highlight.js').CallbackResponse} CallbackResponse
	@typedef {import('highlight.js').CompilerExt} CompilerExt
	*/

	// Grammar extensions / plugins
	// See: https://github.com/highlightjs/highlight.js/issues/2833

	// Grammar extensions allow "syntactic sugar" to be added to the grammar modes
	// without requiring any underlying changes to the compiler internals.

	// `compileMatch` being the perfect small example of now allowing a grammar
	// author to write `match` when they desire to match a single expression rather
	// than being forced to use `begin`.  The extension then just moves `match` into
	// `begin` when it runs.  Ie, no features have been added, but we've just made
	// the experience of writing (and reading grammars) a little bit nicer.

	// ------

	// TODO: We need negative look-behind support to do this properly
	/**
	 * Skip a match if it has a preceding dot
	 *
	 * This is used for `beginKeywords` to prevent matching expressions such as
	 * `bob.keyword.do()`. The mode compiler automatically wires this up as a
	 * special _internal_ 'on:begin' callback for modes with `beginKeywords`
	 * @param {RegExpMatchArray} match
	 * @param {CallbackResponse} response
	 */
	function skipIfHasPrecedingDot(match, response) {
	  const before = match.input[match.index - 1];
	  if (before === ".") {
	    response.ignoreMatch();
	  }
	}

	/**
	 *
	 * @type {CompilerExt}
	 */
	function scopeClassName(mode, _parent) {
	  // eslint-disable-next-line no-undefined
	  if (mode.className !== undefined) {
	    mode.scope = mode.className;
	    delete mode.className;
	  }
	}

	/**
	 * `beginKeywords` syntactic sugar
	 * @type {CompilerExt}
	 */
	function beginKeywords(mode, parent) {
	  if (!parent) return;
	  if (!mode.beginKeywords) return;

	  // for languages with keywords that include non-word characters checking for
	  // a word boundary is not sufficient, so instead we check for a word boundary
	  // or whitespace - this does no harm in any case since our keyword engine
	  // doesn't allow spaces in keywords anyways and we still check for the boundary
	  // first
	  mode.begin = '\\b(' + mode.beginKeywords.split(' ').join('|') + ')(?!\\.)(?=\\b|\\s)';
	  mode.__beforeBegin = skipIfHasPrecedingDot;
	  mode.keywords = mode.keywords || mode.beginKeywords;
	  delete mode.beginKeywords;

	  // prevents double relevance, the keywords themselves provide
	  // relevance, the mode doesn't need to double it
	  // eslint-disable-next-line no-undefined
	  if (mode.relevance === undefined) mode.relevance = 0;
	}

	/**
	 * Allow `illegal` to contain an array of illegal values
	 * @type {CompilerExt}
	 */
	function compileIllegal(mode, _parent) {
	  if (!Array.isArray(mode.illegal)) return;

	  mode.illegal = either(...mode.illegal);
	}

	/**
	 * `match` to match a single expression for readability
	 * @type {CompilerExt}
	 */
	function compileMatch(mode, _parent) {
	  if (!mode.match) return;
	  if (mode.begin || mode.end) throw new Error("begin & end are not supported with match");

	  mode.begin = mode.match;
	  delete mode.match;
	}

	/**
	 * provides the default 1 relevance to all modes
	 * @type {CompilerExt}
	 */
	function compileRelevance(mode, _parent) {
	  // eslint-disable-next-line no-undefined
	  if (mode.relevance === undefined) mode.relevance = 1;
	}

	// allow beforeMatch to act as a "qualifier" for the match
	// the full match begin must be [beforeMatch][begin]
	const beforeMatchExt = (mode, parent) => {
	  if (!mode.beforeMatch) return;
	  // starts conflicts with endsParent which we need to make sure the child
	  // rule is not matched multiple times
	  if (mode.starts) throw new Error("beforeMatch cannot be used with starts");

	  const originalMode = Object.assign({}, mode);
	  Object.keys(mode).forEach((key) => { delete mode[key]; });

	  mode.keywords = originalMode.keywords;
	  mode.begin = concat(originalMode.beforeMatch, lookahead(originalMode.begin));
	  mode.starts = {
	    relevance: 0,
	    contains: [
	      Object.assign(originalMode, { endsParent: true })
	    ]
	  };
	  mode.relevance = 0;

	  delete originalMode.beforeMatch;
	};

	// keywords that should have no default relevance value
	const COMMON_KEYWORDS = [
	  'of',
	  'and',
	  'for',
	  'in',
	  'not',
	  'or',
	  'if',
	  'then',
	  'parent', // common variable name
	  'list', // common variable name
	  'value' // common variable name
	];

	const DEFAULT_KEYWORD_SCOPE = "keyword";

	/**
	 * Given raw keywords from a language definition, compile them.
	 *
	 * @param {string | Record<string,string|string[]> | Array<string>} rawKeywords
	 * @param {boolean} caseInsensitive
	 */
	function compileKeywords(rawKeywords, caseInsensitive, scopeName = DEFAULT_KEYWORD_SCOPE) {
	  /** @type {import("highlight.js/private").KeywordDict} */
	  const compiledKeywords = Object.create(null);

	  // input can be a string of keywords, an array of keywords, or a object with
	  // named keys representing scopeName (which can then point to a string or array)
	  if (typeof rawKeywords === 'string') {
	    compileList(scopeName, rawKeywords.split(" "));
	  } else if (Array.isArray(rawKeywords)) {
	    compileList(scopeName, rawKeywords);
	  } else {
	    Object.keys(rawKeywords).forEach(function(scopeName) {
	      // collapse all our objects back into the parent object
	      Object.assign(
	        compiledKeywords,
	        compileKeywords(rawKeywords[scopeName], caseInsensitive, scopeName)
	      );
	    });
	  }
	  return compiledKeywords;

	  // ---

	  /**
	   * Compiles an individual list of keywords
	   *
	   * Ex: "for if when while|5"
	   *
	   * @param {string} scopeName
	   * @param {Array<string>} keywordList
	   */
	  function compileList(scopeName, keywordList) {
	    if (caseInsensitive) {
	      keywordList = keywordList.map(x => x.toLowerCase());
	    }
	    keywordList.forEach(function(keyword) {
	      const pair = keyword.split('|');
	      compiledKeywords[pair[0]] = [scopeName, scoreForKeyword(pair[0], pair[1])];
	    });
	  }
	}

	/**
	 * Returns the proper score for a given keyword
	 *
	 * Also takes into account comment keywords, which will be scored 0 UNLESS
	 * another score has been manually assigned.
	 * @param {string} keyword
	 * @param {string} [providedScore]
	 */
	function scoreForKeyword(keyword, providedScore) {
	  // manual scores always win over common keywords
	  // so you can force a score of 1 if you really insist
	  if (providedScore) {
	    return Number(providedScore);
	  }

	  return commonKeyword(keyword) ? 0 : 1;
	}

	/**
	 * Determines if a given keyword is common or not
	 *
	 * @param {string} keyword */
	function commonKeyword(keyword) {
	  return COMMON_KEYWORDS.includes(keyword.toLowerCase());
	}

	/*

	For the reasoning behind this please see:
	https://github.com/highlightjs/highlight.js/issues/2880#issuecomment-747275419

	*/

	/**
	 * @type {Record<string, boolean>}
	 */
	const seenDeprecations = {};

	/**
	 * @param {string} message
	 */
	const error = (message) => {
	  console.error(message);
	};

	/**
	 * @param {string} message
	 * @param {any} args
	 */
	const warn = (message, ...args) => {
	  console.log(`WARN: ${message}`, ...args);
	};

	/**
	 * @param {string} version
	 * @param {string} message
	 */
	const deprecated = (version, message) => {
	  if (seenDeprecations[`${version}/${message}`]) return;

	  console.log(`Deprecated as of ${version}. ${message}`);
	  seenDeprecations[`${version}/${message}`] = true;
	};

	/* eslint-disable no-throw-literal */

	/**
	@typedef {import('highlight.js').CompiledMode} CompiledMode
	*/

	const MultiClassError = new Error();

	/**
	 * Renumbers labeled scope names to account for additional inner match
	 * groups that otherwise would break everything.
	 *
	 * Lets say we 3 match scopes:
	 *
	 *   { 1 => ..., 2 => ..., 3 => ... }
	 *
	 * So what we need is a clean match like this:
	 *
	 *   (a)(b)(c) => [ "a", "b", "c" ]
	 *
	 * But this falls apart with inner match groups:
	 *
	 * (a)(((b)))(c) => ["a", "b", "b", "b", "c" ]
	 *
	 * Our scopes are now "out of alignment" and we're repeating `b` 3 times.
	 * What needs to happen is the numbers are remapped:
	 *
	 *   { 1 => ..., 2 => ..., 5 => ... }
	 *
	 * We also need to know that the ONLY groups that should be output
	 * are 1, 2, and 5.  This function handles this behavior.
	 *
	 * @param {CompiledMode} mode
	 * @param {Array<RegExp | string>} regexes
	 * @param {{key: "beginScope"|"endScope"}} opts
	 */
	function remapScopeNames(mode, regexes, { key }) {
	  let offset = 0;
	  const scopeNames = mode[key];
	  /** @type Record<number,boolean> */
	  const emit = {};
	  /** @type Record<number,string> */
	  const positions = {};

	  for (let i = 1; i <= regexes.length; i++) {
	    positions[i + offset] = scopeNames[i];
	    emit[i + offset] = true;
	    offset += countMatchGroups(regexes[i - 1]);
	  }
	  // we use _emit to keep track of which match groups are "top-level" to avoid double
	  // output from inside match groups
	  mode[key] = positions;
	  mode[key]._emit = emit;
	  mode[key]._multi = true;
	}

	/**
	 * @param {CompiledMode} mode
	 */
	function beginMultiClass(mode) {
	  if (!Array.isArray(mode.begin)) return;

	  if (mode.skip || mode.excludeBegin || mode.returnBegin) {
	    error("skip, excludeBegin, returnBegin not compatible with beginScope: {}");
	    throw MultiClassError;
	  }

	  if (typeof mode.beginScope !== "object" || mode.beginScope === null) {
	    error("beginScope must be object");
	    throw MultiClassError;
	  }

	  remapScopeNames(mode, mode.begin, { key: "beginScope" });
	  mode.begin = _rewriteBackreferences(mode.begin, { joinWith: "" });
	}

	/**
	 * @param {CompiledMode} mode
	 */
	function endMultiClass(mode) {
	  if (!Array.isArray(mode.end)) return;

	  if (mode.skip || mode.excludeEnd || mode.returnEnd) {
	    error("skip, excludeEnd, returnEnd not compatible with endScope: {}");
	    throw MultiClassError;
	  }

	  if (typeof mode.endScope !== "object" || mode.endScope === null) {
	    error("endScope must be object");
	    throw MultiClassError;
	  }

	  remapScopeNames(mode, mode.end, { key: "endScope" });
	  mode.end = _rewriteBackreferences(mode.end, { joinWith: "" });
	}

	/**
	 * this exists only to allow `scope: {}` to be used beside `match:`
	 * Otherwise `beginScope` would necessary and that would look weird

	  {
	    match: [ /def/, /\w+/ ]
	    scope: { 1: "keyword" , 2: "title" }
	  }

	 * @param {CompiledMode} mode
	 */
	function scopeSugar(mode) {
	  if (mode.scope && typeof mode.scope === "object" && mode.scope !== null) {
	    mode.beginScope = mode.scope;
	    delete mode.scope;
	  }
	}

	/**
	 * @param {CompiledMode} mode
	 */
	function MultiClass(mode) {
	  scopeSugar(mode);

	  if (typeof mode.beginScope === "string") {
	    mode.beginScope = { _wrap: mode.beginScope };
	  }
	  if (typeof mode.endScope === "string") {
	    mode.endScope = { _wrap: mode.endScope };
	  }

	  beginMultiClass(mode);
	  endMultiClass(mode);
	}

	/**
	@typedef {import('highlight.js').Mode} Mode
	@typedef {import('highlight.js').CompiledMode} CompiledMode
	@typedef {import('highlight.js').Language} Language
	@typedef {import('highlight.js').HLJSPlugin} HLJSPlugin
	@typedef {import('highlight.js').CompiledLanguage} CompiledLanguage
	*/

	// compilation

	/**
	 * Compiles a language definition result
	 *
	 * Given the raw result of a language definition (Language), compiles this so
	 * that it is ready for highlighting code.
	 * @param {Language} language
	 * @returns {CompiledLanguage}
	 */
	function compileLanguage(language) {
	  /**
	   * Builds a regex with the case sensitivity of the current language
	   *
	   * @param {RegExp | string} value
	   * @param {boolean} [global]
	   */
	  function langRe(value, global) {
	    return new RegExp(
	      source(value),
	      'm'
	      + (language.case_insensitive ? 'i' : '')
	      + (language.unicodeRegex ? 'u' : '')
	      + (global ? 'g' : '')
	    );
	  }

	  /**
	    Stores multiple regular expressions and allows you to quickly search for
	    them all in a string simultaneously - returning the first match.  It does
	    this by creating a huge (a|b|c) regex - each individual item wrapped with ()
	    and joined by `|` - using match groups to track position.  When a match is
	    found checking which position in the array has content allows us to figure
	    out which of the original regexes / match groups triggered the match.

	    The match object itself (the result of `Regex.exec`) is returned but also
	    enhanced by merging in any meta-data that was registered with the regex.
	    This is how we keep track of which mode matched, and what type of rule
	    (`illegal`, `begin`, end, etc).
	  */
	  class MultiRegex {
	    constructor() {
	      this.matchIndexes = {};
	      // @ts-ignore
	      this.regexes = [];
	      this.matchAt = 1;
	      this.position = 0;
	    }

	    // @ts-ignore
	    addRule(re, opts) {
	      opts.position = this.position++;
	      // @ts-ignore
	      this.matchIndexes[this.matchAt] = opts;
	      this.regexes.push([opts, re]);
	      this.matchAt += countMatchGroups(re) + 1;
	    }

	    compile() {
	      if (this.regexes.length === 0) {
	        // avoids the need to check length every time exec is called
	        // @ts-ignore
	        this.exec = () => null;
	      }
	      const terminators = this.regexes.map(el => el[1]);
	      this.matcherRe = langRe(_rewriteBackreferences(terminators, { joinWith: '|' }), true);
	      this.lastIndex = 0;
	    }

	    /** @param {string} s */
	    exec(s) {
	      this.matcherRe.lastIndex = this.lastIndex;
	      const match = this.matcherRe.exec(s);
	      if (!match) { return null; }

	      // eslint-disable-next-line no-undefined
	      const i = match.findIndex((el, i) => i > 0 && el !== undefined);
	      // @ts-ignore
	      const matchData = this.matchIndexes[i];
	      // trim off any earlier non-relevant match groups (ie, the other regex
	      // match groups that make up the multi-matcher)
	      match.splice(0, i);

	      return Object.assign(match, matchData);
	    }
	  }

	  /*
	    Created to solve the key deficiently with MultiRegex - there is no way to
	    test for multiple matches at a single location.  Why would we need to do
	    that?  In the future a more dynamic engine will allow certain matches to be
	    ignored.  An example: if we matched say the 3rd regex in a large group but
	    decided to ignore it - we'd need to started testing again at the 4th
	    regex... but MultiRegex itself gives us no real way to do that.

	    So what this class creates MultiRegexs on the fly for whatever search
	    position they are needed.

	    NOTE: These additional MultiRegex objects are created dynamically.  For most
	    grammars most of the time we will never actually need anything more than the
	    first MultiRegex - so this shouldn't have too much overhead.

	    Say this is our search group, and we match regex3, but wish to ignore it.

	      regex1 | regex2 | regex3 | regex4 | regex5    ' ie, startAt = 0

	    What we need is a new MultiRegex that only includes the remaining
	    possibilities:

	      regex4 | regex5                               ' ie, startAt = 3

	    This class wraps all that complexity up in a simple API... `startAt` decides
	    where in the array of expressions to start doing the matching. It
	    auto-increments, so if a match is found at position 2, then startAt will be
	    set to 3.  If the end is reached startAt will return to 0.

	    MOST of the time the parser will be setting startAt manually to 0.
	  */
	  class ResumableMultiRegex {
	    constructor() {
	      // @ts-ignore
	      this.rules = [];
	      // @ts-ignore
	      this.multiRegexes = [];
	      this.count = 0;

	      this.lastIndex = 0;
	      this.regexIndex = 0;
	    }

	    // @ts-ignore
	    getMatcher(index) {
	      if (this.multiRegexes[index]) return this.multiRegexes[index];

	      const matcher = new MultiRegex();
	      this.rules.slice(index).forEach(([re, opts]) => matcher.addRule(re, opts));
	      matcher.compile();
	      this.multiRegexes[index] = matcher;
	      return matcher;
	    }

	    resumingScanAtSamePosition() {
	      return this.regexIndex !== 0;
	    }

	    considerAll() {
	      this.regexIndex = 0;
	    }

	    // @ts-ignore
	    addRule(re, opts) {
	      this.rules.push([re, opts]);
	      if (opts.type === "begin") this.count++;
	    }

	    /** @param {string} s */
	    exec(s) {
	      const m = this.getMatcher(this.regexIndex);
	      m.lastIndex = this.lastIndex;
	      let result = m.exec(s);

	      // The following is because we have no easy way to say "resume scanning at the
	      // existing position but also skip the current rule ONLY". What happens is
	      // all prior rules are also skipped which can result in matching the wrong
	      // thing. Example of matching "booger":

	      // our matcher is [string, "booger", number]
	      //
	      // ....booger....

	      // if "booger" is ignored then we'd really need a regex to scan from the
	      // SAME position for only: [string, number] but ignoring "booger" (if it
	      // was the first match), a simple resume would scan ahead who knows how
	      // far looking only for "number", ignoring potential string matches (or
	      // future "booger" matches that might be valid.)

	      // So what we do: We execute two matchers, one resuming at the same
	      // position, but the second full matcher starting at the position after:

	      //     /--- resume first regex match here (for [number])
	      //     |/---- full match here for [string, "booger", number]
	      //     vv
	      // ....booger....

	      // Which ever results in a match first is then used. So this 3-4 step
	      // process essentially allows us to say "match at this position, excluding
	      // a prior rule that was ignored".
	      //
	      // 1. Match "booger" first, ignore. Also proves that [string] does non match.
	      // 2. Resume matching for [number]
	      // 3. Match at index + 1 for [string, "booger", number]
	      // 4. If #2 and #3 result in matches, which came first?
	      if (this.resumingScanAtSamePosition()) {
	        if (result && result.index === this.lastIndex) ; else { // use the second matcher result
	          const m2 = this.getMatcher(0);
	          m2.lastIndex = this.lastIndex + 1;
	          result = m2.exec(s);
	        }
	      }

	      if (result) {
	        this.regexIndex += result.position + 1;
	        if (this.regexIndex === this.count) {
	          // wrap-around to considering all matches again
	          this.considerAll();
	        }
	      }

	      return result;
	    }
	  }

	  /**
	   * Given a mode, builds a huge ResumableMultiRegex that can be used to walk
	   * the content and find matches.
	   *
	   * @param {CompiledMode} mode
	   * @returns {ResumableMultiRegex}
	   */
	  function buildModeRegex(mode) {
	    const mm = new ResumableMultiRegex();

	    mode.contains.forEach(term => mm.addRule(term.begin, { rule: term, type: "begin" }));

	    if (mode.terminatorEnd) {
	      mm.addRule(mode.terminatorEnd, { type: "end" });
	    }
	    if (mode.illegal) {
	      mm.addRule(mode.illegal, { type: "illegal" });
	    }

	    return mm;
	  }

	  /** skip vs abort vs ignore
	   *
	   * @skip   - The mode is still entered and exited normally (and contains rules apply),
	   *           but all content is held and added to the parent buffer rather than being
	   *           output when the mode ends.  Mostly used with `sublanguage` to build up
	   *           a single large buffer than can be parsed by sublanguage.
	   *
	   *             - The mode begin ands ends normally.
	   *             - Content matched is added to the parent mode buffer.
	   *             - The parser cursor is moved forward normally.
	   *
	   * @abort  - A hack placeholder until we have ignore.  Aborts the mode (as if it
	   *           never matched) but DOES NOT continue to match subsequent `contains`
	   *           modes.  Abort is bad/suboptimal because it can result in modes
	   *           farther down not getting applied because an earlier rule eats the
	   *           content but then aborts.
	   *
	   *             - The mode does not begin.
	   *             - Content matched by `begin` is added to the mode buffer.
	   *             - The parser cursor is moved forward accordingly.
	   *
	   * @ignore - Ignores the mode (as if it never matched) and continues to match any
	   *           subsequent `contains` modes.  Ignore isn't technically possible with
	   *           the current parser implementation.
	   *
	   *             - The mode does not begin.
	   *             - Content matched by `begin` is ignored.
	   *             - The parser cursor is not moved forward.
	   */

	  /**
	   * Compiles an individual mode
	   *
	   * This can raise an error if the mode contains certain detectable known logic
	   * issues.
	   * @param {Mode} mode
	   * @param {CompiledMode | null} [parent]
	   * @returns {CompiledMode | never}
	   */
	  function compileMode(mode, parent) {
	    const cmode = /** @type CompiledMode */ (mode);
	    if (mode.isCompiled) return cmode;

	    [
	      scopeClassName,
	      // do this early so compiler extensions generally don't have to worry about
	      // the distinction between match/begin
	      compileMatch,
	      MultiClass,
	      beforeMatchExt
	    ].forEach(ext => ext(mode, parent));

	    language.compilerExtensions.forEach(ext => ext(mode, parent));

	    // __beforeBegin is considered private API, internal use only
	    mode.__beforeBegin = null;

	    [
	      beginKeywords,
	      // do this later so compiler extensions that come earlier have access to the
	      // raw array if they wanted to perhaps manipulate it, etc.
	      compileIllegal,
	      // default to 1 relevance if not specified
	      compileRelevance
	    ].forEach(ext => ext(mode, parent));

	    mode.isCompiled = true;

	    let keywordPattern = null;
	    if (typeof mode.keywords === "object" && mode.keywords.$pattern) {
	      // we need a copy because keywords might be compiled multiple times
	      // so we can't go deleting $pattern from the original on the first
	      // pass
	      mode.keywords = Object.assign({}, mode.keywords);
	      keywordPattern = mode.keywords.$pattern;
	      delete mode.keywords.$pattern;
	    }
	    keywordPattern = keywordPattern || /\w+/;

	    if (mode.keywords) {
	      mode.keywords = compileKeywords(mode.keywords, language.case_insensitive);
	    }

	    cmode.keywordPatternRe = langRe(keywordPattern, true);

	    if (parent) {
	      if (!mode.begin) mode.begin = /\B|\b/;
	      cmode.beginRe = langRe(cmode.begin);
	      if (!mode.end && !mode.endsWithParent) mode.end = /\B|\b/;
	      if (mode.end) cmode.endRe = langRe(cmode.end);
	      cmode.terminatorEnd = source(cmode.end) || '';
	      if (mode.endsWithParent && parent.terminatorEnd) {
	        cmode.terminatorEnd += (mode.end ? '|' : '') + parent.terminatorEnd;
	      }
	    }
	    if (mode.illegal) cmode.illegalRe = langRe(/** @type {RegExp | string} */ (mode.illegal));
	    if (!mode.contains) mode.contains = [];

	    mode.contains = [].concat(...mode.contains.map(function(c) {
	      return expandOrCloneMode(c === 'self' ? mode : c);
	    }));
	    mode.contains.forEach(function(c) { compileMode(/** @type Mode */ (c), cmode); });

	    if (mode.starts) {
	      compileMode(mode.starts, parent);
	    }

	    cmode.matcher = buildModeRegex(cmode);
	    return cmode;
	  }

	  if (!language.compilerExtensions) language.compilerExtensions = [];

	  // self is not valid at the top-level
	  if (language.contains && language.contains.includes('self')) {
	    throw new Error("ERR: contains `self` is not supported at the top-level of a language.  See documentation.");
	  }

	  // we need a null object, which inherit will guarantee
	  language.classNameAliases = inherit$1(language.classNameAliases || {});

	  return compileMode(/** @type Mode */ (language));
	}

	/**
	 * Determines if a mode has a dependency on it's parent or not
	 *
	 * If a mode does have a parent dependency then often we need to clone it if
	 * it's used in multiple places so that each copy points to the correct parent,
	 * where-as modes without a parent can often safely be re-used at the bottom of
	 * a mode chain.
	 *
	 * @param {Mode | null} mode
	 * @returns {boolean} - is there a dependency on the parent?
	 * */
	function dependencyOnParent(mode) {
	  if (!mode) return false;

	  return mode.endsWithParent || dependencyOnParent(mode.starts);
	}

	/**
	 * Expands a mode or clones it if necessary
	 *
	 * This is necessary for modes with parental dependenceis (see notes on
	 * `dependencyOnParent`) and for nodes that have `variants` - which must then be
	 * exploded into their own individual modes at compile time.
	 *
	 * @param {Mode} mode
	 * @returns {Mode | Mode[]}
	 * */
	function expandOrCloneMode(mode) {
	  if (mode.variants && !mode.cachedVariants) {
	    mode.cachedVariants = mode.variants.map(function(variant) {
	      return inherit$1(mode, { variants: null }, variant);
	    });
	  }

	  // EXPAND
	  // if we have variants then essentially "replace" the mode with the variants
	  // this happens in compileMode, where this function is called from
	  if (mode.cachedVariants) {
	    return mode.cachedVariants;
	  }

	  // CLONE
	  // if we have dependencies on parents then we need a unique
	  // instance of ourselves, so we can be reused with many
	  // different parents without issue
	  if (dependencyOnParent(mode)) {
	    return inherit$1(mode, { starts: mode.starts ? inherit$1(mode.starts) : null });
	  }

	  if (Object.isFrozen(mode)) {
	    return inherit$1(mode);
	  }

	  // no special dependency issues, just return ourselves
	  return mode;
	}

	var version = "11.11.1";

	class HTMLInjectionError extends Error {
	  constructor(reason, html) {
	    super(reason);
	    this.name = "HTMLInjectionError";
	    this.html = html;
	  }
	}

	/*
	Syntax highlighting with language autodetection.
	https://highlightjs.org/
	*/



	/**
	@typedef {import('highlight.js').Mode} Mode
	@typedef {import('highlight.js').CompiledMode} CompiledMode
	@typedef {import('highlight.js').CompiledScope} CompiledScope
	@typedef {import('highlight.js').Language} Language
	@typedef {import('highlight.js').HLJSApi} HLJSApi
	@typedef {import('highlight.js').HLJSPlugin} HLJSPlugin
	@typedef {import('highlight.js').PluginEvent} PluginEvent
	@typedef {import('highlight.js').HLJSOptions} HLJSOptions
	@typedef {import('highlight.js').LanguageFn} LanguageFn
	@typedef {import('highlight.js').HighlightedHTMLElement} HighlightedHTMLElement
	@typedef {import('highlight.js').BeforeHighlightContext} BeforeHighlightContext
	@typedef {import('highlight.js/private').MatchType} MatchType
	@typedef {import('highlight.js/private').KeywordData} KeywordData
	@typedef {import('highlight.js/private').EnhancedMatch} EnhancedMatch
	@typedef {import('highlight.js/private').AnnotatedError} AnnotatedError
	@typedef {import('highlight.js').AutoHighlightResult} AutoHighlightResult
	@typedef {import('highlight.js').HighlightOptions} HighlightOptions
	@typedef {import('highlight.js').HighlightResult} HighlightResult
	*/


	const escape = escapeHTML;
	const inherit = inherit$1;
	const NO_MATCH = Symbol("nomatch");
	const MAX_KEYWORD_HITS = 7;

	/**
	 * @param {any} hljs - object that is extended (legacy)
	 * @returns {HLJSApi}
	 */
	const HLJS = function(hljs) {
	  // Global internal variables used within the highlight.js library.
	  /** @type {Record<string, Language>} */
	  const languages = Object.create(null);
	  /** @type {Record<string, string>} */
	  const aliases = Object.create(null);
	  /** @type {HLJSPlugin[]} */
	  const plugins = [];

	  // safe/production mode - swallows more errors, tries to keep running
	  // even if a single syntax or parse hits a fatal error
	  let SAFE_MODE = true;
	  const LANGUAGE_NOT_FOUND = "Could not find the language '{}', did you forget to load/include a language module?";
	  /** @type {Language} */
	  const PLAINTEXT_LANGUAGE = { disableAutodetect: true, name: 'Plain text', contains: [] };

	  // Global options used when within external APIs. This is modified when
	  // calling the `hljs.configure` function.
	  /** @type HLJSOptions */
	  let options = {
	    ignoreUnescapedHTML: false,
	    throwUnescapedHTML: false,
	    noHighlightRe: /^(no-?highlight)$/i,
	    languageDetectRe: /\blang(?:uage)?-([\w-]+)\b/i,
	    classPrefix: 'hljs-',
	    cssSelector: 'pre code',
	    languages: null,
	    // beta configuration options, subject to change, welcome to discuss
	    // https://github.com/highlightjs/highlight.js/issues/1086
	    __emitter: TokenTreeEmitter
	  };

	  /* Utility functions */

	  /**
	   * Tests a language name to see if highlighting should be skipped
	   * @param {string} languageName
	   */
	  function shouldNotHighlight(languageName) {
	    return options.noHighlightRe.test(languageName);
	  }

	  /**
	   * @param {HighlightedHTMLElement} block - the HTML element to determine language for
	   */
	  function blockLanguage(block) {
	    let classes = block.className + ' ';

	    classes += block.parentNode ? block.parentNode.className : '';

	    // language-* takes precedence over non-prefixed class names.
	    const match = options.languageDetectRe.exec(classes);
	    if (match) {
	      const language = getLanguage(match[1]);
	      if (!language) {
	        warn(LANGUAGE_NOT_FOUND.replace("{}", match[1]));
	        warn("Falling back to no-highlight mode for this block.", block);
	      }
	      return language ? match[1] : 'no-highlight';
	    }

	    return classes
	      .split(/\s+/)
	      .find((_class) => shouldNotHighlight(_class) || getLanguage(_class));
	  }

	  /**
	   * Core highlighting function.
	   *
	   * OLD API
	   * highlight(lang, code, ignoreIllegals, continuation)
	   *
	   * NEW API
	   * highlight(code, {lang, ignoreIllegals})
	   *
	   * @param {string} codeOrLanguageName - the language to use for highlighting
	   * @param {string | HighlightOptions} optionsOrCode - the code to highlight
	   * @param {boolean} [ignoreIllegals] - whether to ignore illegal matches, default is to bail
	   *
	   * @returns {HighlightResult} Result - an object that represents the result
	   * @property {string} language - the language name
	   * @property {number} relevance - the relevance score
	   * @property {string} value - the highlighted HTML code
	   * @property {string} code - the original raw code
	   * @property {CompiledMode} top - top of the current mode stack
	   * @property {boolean} illegal - indicates whether any illegal matches were found
	  */
	  function highlight(codeOrLanguageName, optionsOrCode, ignoreIllegals) {
	    let code = "";
	    let languageName = "";
	    if (typeof optionsOrCode === "object") {
	      code = codeOrLanguageName;
	      ignoreIllegals = optionsOrCode.ignoreIllegals;
	      languageName = optionsOrCode.language;
	    } else {
	      // old API
	      deprecated("10.7.0", "highlight(lang, code, ...args) has been deprecated.");
	      deprecated("10.7.0", "Please use highlight(code, options) instead.\nhttps://github.com/highlightjs/highlight.js/issues/2277");
	      languageName = codeOrLanguageName;
	      code = optionsOrCode;
	    }

	    // https://github.com/highlightjs/highlight.js/issues/3149
	    // eslint-disable-next-line no-undefined
	    if (ignoreIllegals === undefined) { ignoreIllegals = true; }

	    /** @type {BeforeHighlightContext} */
	    const context = {
	      code,
	      language: languageName
	    };
	    // the plugin can change the desired language or the code to be highlighted
	    // just be changing the object it was passed
	    fire("before:highlight", context);

	    // a before plugin can usurp the result completely by providing it's own
	    // in which case we don't even need to call highlight
	    const result = context.result
	      ? context.result
	      : _highlight(context.language, context.code, ignoreIllegals);

	    result.code = context.code;
	    // the plugin can change anything in result to suite it
	    fire("after:highlight", result);

	    return result;
	  }

	  /**
	   * private highlight that's used internally and does not fire callbacks
	   *
	   * @param {string} languageName - the language to use for highlighting
	   * @param {string} codeToHighlight - the code to highlight
	   * @param {boolean?} [ignoreIllegals] - whether to ignore illegal matches, default is to bail
	   * @param {CompiledMode?} [continuation] - current continuation mode, if any
	   * @returns {HighlightResult} - result of the highlight operation
	  */
	  function _highlight(languageName, codeToHighlight, ignoreIllegals, continuation) {
	    const keywordHits = Object.create(null);

	    /**
	     * Return keyword data if a match is a keyword
	     * @param {CompiledMode} mode - current mode
	     * @param {string} matchText - the textual match
	     * @returns {KeywordData | false}
	     */
	    function keywordData(mode, matchText) {
	      return mode.keywords[matchText];
	    }

	    function processKeywords() {
	      if (!top.keywords) {
	        emitter.addText(modeBuffer);
	        return;
	      }

	      let lastIndex = 0;
	      top.keywordPatternRe.lastIndex = 0;
	      let match = top.keywordPatternRe.exec(modeBuffer);
	      let buf = "";

	      while (match) {
	        buf += modeBuffer.substring(lastIndex, match.index);
	        const word = language.case_insensitive ? match[0].toLowerCase() : match[0];
	        const data = keywordData(top, word);
	        if (data) {
	          const [kind, keywordRelevance] = data;
	          emitter.addText(buf);
	          buf = "";

	          keywordHits[word] = (keywordHits[word] || 0) + 1;
	          if (keywordHits[word] <= MAX_KEYWORD_HITS) relevance += keywordRelevance;
	          if (kind.startsWith("_")) {
	            // _ implied for relevance only, do not highlight
	            // by applying a class name
	            buf += match[0];
	          } else {
	            const cssClass = language.classNameAliases[kind] || kind;
	            emitKeyword(match[0], cssClass);
	          }
	        } else {
	          buf += match[0];
	        }
	        lastIndex = top.keywordPatternRe.lastIndex;
	        match = top.keywordPatternRe.exec(modeBuffer);
	      }
	      buf += modeBuffer.substring(lastIndex);
	      emitter.addText(buf);
	    }

	    function processSubLanguage() {
	      if (modeBuffer === "") return;
	      /** @type HighlightResult */
	      let result = null;

	      if (typeof top.subLanguage === 'string') {
	        if (!languages[top.subLanguage]) {
	          emitter.addText(modeBuffer);
	          return;
	        }
	        result = _highlight(top.subLanguage, modeBuffer, true, continuations[top.subLanguage]);
	        continuations[top.subLanguage] = /** @type {CompiledMode} */ (result._top);
	      } else {
	        result = highlightAuto(modeBuffer, top.subLanguage.length ? top.subLanguage : null);
	      }

	      // Counting embedded language score towards the host language may be disabled
	      // with zeroing the containing mode relevance. Use case in point is Markdown that
	      // allows XML everywhere and makes every XML snippet to have a much larger Markdown
	      // score.
	      if (top.relevance > 0) {
	        relevance += result.relevance;
	      }
	      emitter.__addSublanguage(result._emitter, result.language);
	    }

	    function processBuffer() {
	      if (top.subLanguage != null) {
	        processSubLanguage();
	      } else {
	        processKeywords();
	      }
	      modeBuffer = '';
	    }

	    /**
	     * @param {string} text
	     * @param {string} scope
	     */
	    function emitKeyword(keyword, scope) {
	      if (keyword === "") return;

	      emitter.startScope(scope);
	      emitter.addText(keyword);
	      emitter.endScope();
	    }

	    /**
	     * @param {CompiledScope} scope
	     * @param {RegExpMatchArray} match
	     */
	    function emitMultiClass(scope, match) {
	      let i = 1;
	      const max = match.length - 1;
	      while (i <= max) {
	        if (!scope._emit[i]) { i++; continue; }
	        const klass = language.classNameAliases[scope[i]] || scope[i];
	        const text = match[i];
	        if (klass) {
	          emitKeyword(text, klass);
	        } else {
	          modeBuffer = text;
	          processKeywords();
	          modeBuffer = "";
	        }
	        i++;
	      }
	    }

	    /**
	     * @param {CompiledMode} mode - new mode to start
	     * @param {RegExpMatchArray} match
	     */
	    function startNewMode(mode, match) {
	      if (mode.scope && typeof mode.scope === "string") {
	        emitter.openNode(language.classNameAliases[mode.scope] || mode.scope);
	      }
	      if (mode.beginScope) {
	        // beginScope just wraps the begin match itself in a scope
	        if (mode.beginScope._wrap) {
	          emitKeyword(modeBuffer, language.classNameAliases[mode.beginScope._wrap] || mode.beginScope._wrap);
	          modeBuffer = "";
	        } else if (mode.beginScope._multi) {
	          // at this point modeBuffer should just be the match
	          emitMultiClass(mode.beginScope, match);
	          modeBuffer = "";
	        }
	      }

	      top = Object.create(mode, { parent: { value: top } });
	      return top;
	    }

	    /**
	     * @param {CompiledMode } mode - the mode to potentially end
	     * @param {RegExpMatchArray} match - the latest match
	     * @param {string} matchPlusRemainder - match plus remainder of content
	     * @returns {CompiledMode | void} - the next mode, or if void continue on in current mode
	     */
	    function endOfMode(mode, match, matchPlusRemainder) {
	      let matched = startsWith(mode.endRe, matchPlusRemainder);

	      if (matched) {
	        if (mode["on:end"]) {
	          const resp = new Response(mode);
	          mode["on:end"](match, resp);
	          if (resp.isMatchIgnored) matched = false;
	        }

	        if (matched) {
	          while (mode.endsParent && mode.parent) {
	            mode = mode.parent;
	          }
	          return mode;
	        }
	      }
	      // even if on:end fires an `ignore` it's still possible
	      // that we might trigger the end node because of a parent mode
	      if (mode.endsWithParent) {
	        return endOfMode(mode.parent, match, matchPlusRemainder);
	      }
	    }

	    /**
	     * Handle matching but then ignoring a sequence of text
	     *
	     * @param {string} lexeme - string containing full match text
	     */
	    function doIgnore(lexeme) {
	      if (top.matcher.regexIndex === 0) {
	        // no more regexes to potentially match here, so we move the cursor forward one
	        // space
	        modeBuffer += lexeme[0];
	        return 1;
	      } else {
	        // no need to move the cursor, we still have additional regexes to try and
	        // match at this very spot
	        resumeScanAtSamePosition = true;
	        return 0;
	      }
	    }

	    /**
	     * Handle the start of a new potential mode match
	     *
	     * @param {EnhancedMatch} match - the current match
	     * @returns {number} how far to advance the parse cursor
	     */
	    function doBeginMatch(match) {
	      const lexeme = match[0];
	      const newMode = match.rule;

	      const resp = new Response(newMode);
	      // first internal before callbacks, then the public ones
	      const beforeCallbacks = [newMode.__beforeBegin, newMode["on:begin"]];
	      for (const cb of beforeCallbacks) {
	        if (!cb) continue;
	        cb(match, resp);
	        if (resp.isMatchIgnored) return doIgnore(lexeme);
	      }

	      if (newMode.skip) {
	        modeBuffer += lexeme;
	      } else {
	        if (newMode.excludeBegin) {
	          modeBuffer += lexeme;
	        }
	        processBuffer();
	        if (!newMode.returnBegin && !newMode.excludeBegin) {
	          modeBuffer = lexeme;
	        }
	      }
	      startNewMode(newMode, match);
	      return newMode.returnBegin ? 0 : lexeme.length;
	    }

	    /**
	     * Handle the potential end of mode
	     *
	     * @param {RegExpMatchArray} match - the current match
	     */
	    function doEndMatch(match) {
	      const lexeme = match[0];
	      const matchPlusRemainder = codeToHighlight.substring(match.index);

	      const endMode = endOfMode(top, match, matchPlusRemainder);
	      if (!endMode) { return NO_MATCH; }

	      const origin = top;
	      if (top.endScope && top.endScope._wrap) {
	        processBuffer();
	        emitKeyword(lexeme, top.endScope._wrap);
	      } else if (top.endScope && top.endScope._multi) {
	        processBuffer();
	        emitMultiClass(top.endScope, match);
	      } else if (origin.skip) {
	        modeBuffer += lexeme;
	      } else {
	        if (!(origin.returnEnd || origin.excludeEnd)) {
	          modeBuffer += lexeme;
	        }
	        processBuffer();
	        if (origin.excludeEnd) {
	          modeBuffer = lexeme;
	        }
	      }
	      do {
	        if (top.scope) {
	          emitter.closeNode();
	        }
	        if (!top.skip && !top.subLanguage) {
	          relevance += top.relevance;
	        }
	        top = top.parent;
	      } while (top !== endMode.parent);
	      if (endMode.starts) {
	        startNewMode(endMode.starts, match);
	      }
	      return origin.returnEnd ? 0 : lexeme.length;
	    }

	    function processContinuations() {
	      const list = [];
	      for (let current = top; current !== language; current = current.parent) {
	        if (current.scope) {
	          list.unshift(current.scope);
	        }
	      }
	      list.forEach(item => emitter.openNode(item));
	    }

	    /** @type {{type?: MatchType, index?: number, rule?: Mode}}} */
	    let lastMatch = {};

	    /**
	     *  Process an individual match
	     *
	     * @param {string} textBeforeMatch - text preceding the match (since the last match)
	     * @param {EnhancedMatch} [match] - the match itself
	     */
	    function processLexeme(textBeforeMatch, match) {
	      const lexeme = match && match[0];

	      // add non-matched text to the current mode buffer
	      modeBuffer += textBeforeMatch;

	      if (lexeme == null) {
	        processBuffer();
	        return 0;
	      }

	      // we've found a 0 width match and we're stuck, so we need to advance
	      // this happens when we have badly behaved rules that have optional matchers to the degree that
	      // sometimes they can end up matching nothing at all
	      // Ref: https://github.com/highlightjs/highlight.js/issues/2140
	      if (lastMatch.type === "begin" && match.type === "end" && lastMatch.index === match.index && lexeme === "") {
	        // spit the "skipped" character that our regex choked on back into the output sequence
	        modeBuffer += codeToHighlight.slice(match.index, match.index + 1);
	        if (!SAFE_MODE) {
	          /** @type {AnnotatedError} */
	          const err = new Error(`0 width match regex (${languageName})`);
	          err.languageName = languageName;
	          err.badRule = lastMatch.rule;
	          throw err;
	        }
	        return 1;
	      }
	      lastMatch = match;

	      if (match.type === "begin") {
	        return doBeginMatch(match);
	      } else if (match.type === "illegal" && !ignoreIllegals) {
	        // illegal match, we do not continue processing
	        /** @type {AnnotatedError} */
	        const err = new Error('Illegal lexeme "' + lexeme + '" for mode "' + (top.scope || '<unnamed>') + '"');
	        err.mode = top;
	        throw err;
	      } else if (match.type === "end") {
	        const processed = doEndMatch(match);
	        if (processed !== NO_MATCH) {
	          return processed;
	        }
	      }

	      // edge case for when illegal matches $ (end of line) which is technically
	      // a 0 width match but not a begin/end match so it's not caught by the
	      // first handler (when ignoreIllegals is true)
	      if (match.type === "illegal" && lexeme === "") {
	        // advance so we aren't stuck in an infinite loop
	        modeBuffer += "\n";
	        return 1;
	      }

	      // infinite loops are BAD, this is a last ditch catch all. if we have a
	      // decent number of iterations yet our index (cursor position in our
	      // parsing) still 3x behind our index then something is very wrong
	      // so we bail
	      if (iterations > 100000 && iterations > match.index * 3) {
	        const err = new Error('potential infinite loop, way more iterations than matches');
	        throw err;
	      }

	      /*
	      Why might be find ourselves here?  An potential end match that was
	      triggered but could not be completed.  IE, `doEndMatch` returned NO_MATCH.
	      (this could be because a callback requests the match be ignored, etc)

	      This causes no real harm other than stopping a few times too many.
	      */

	      modeBuffer += lexeme;
	      return lexeme.length;
	    }

	    const language = getLanguage(languageName);
	    if (!language) {
	      error(LANGUAGE_NOT_FOUND.replace("{}", languageName));
	      throw new Error('Unknown language: "' + languageName + '"');
	    }

	    const md = compileLanguage(language);
	    let result = '';
	    /** @type {CompiledMode} */
	    let top = continuation || md;
	    /** @type Record<string,CompiledMode> */
	    const continuations = {}; // keep continuations for sub-languages
	    const emitter = new options.__emitter(options);
	    processContinuations();
	    let modeBuffer = '';
	    let relevance = 0;
	    let index = 0;
	    let iterations = 0;
	    let resumeScanAtSamePosition = false;

	    try {
	      if (!language.__emitTokens) {
	        top.matcher.considerAll();

	        for (;;) {
	          iterations++;
	          if (resumeScanAtSamePosition) {
	            // only regexes not matched previously will now be
	            // considered for a potential match
	            resumeScanAtSamePosition = false;
	          } else {
	            top.matcher.considerAll();
	          }
	          top.matcher.lastIndex = index;

	          const match = top.matcher.exec(codeToHighlight);
	          // console.log("match", match[0], match.rule && match.rule.begin)

	          if (!match) break;

	          const beforeMatch = codeToHighlight.substring(index, match.index);
	          const processedCount = processLexeme(beforeMatch, match);
	          index = match.index + processedCount;
	        }
	        processLexeme(codeToHighlight.substring(index));
	      } else {
	        language.__emitTokens(codeToHighlight, emitter);
	      }

	      emitter.finalize();
	      result = emitter.toHTML();

	      return {
	        language: languageName,
	        value: result,
	        relevance,
	        illegal: false,
	        _emitter: emitter,
	        _top: top
	      };
	    } catch (err) {
	      if (err.message && err.message.includes('Illegal')) {
	        return {
	          language: languageName,
	          value: escape(codeToHighlight),
	          illegal: true,
	          relevance: 0,
	          _illegalBy: {
	            message: err.message,
	            index,
	            context: codeToHighlight.slice(index - 100, index + 100),
	            mode: err.mode,
	            resultSoFar: result
	          },
	          _emitter: emitter
	        };
	      } else if (SAFE_MODE) {
	        return {
	          language: languageName,
	          value: escape(codeToHighlight),
	          illegal: false,
	          relevance: 0,
	          errorRaised: err,
	          _emitter: emitter,
	          _top: top
	        };
	      } else {
	        throw err;
	      }
	    }
	  }

	  /**
	   * returns a valid highlight result, without actually doing any actual work,
	   * auto highlight starts with this and it's possible for small snippets that
	   * auto-detection may not find a better match
	   * @param {string} code
	   * @returns {HighlightResult}
	   */
	  function justTextHighlightResult(code) {
	    const result = {
	      value: escape(code),
	      illegal: false,
	      relevance: 0,
	      _top: PLAINTEXT_LANGUAGE,
	      _emitter: new options.__emitter(options)
	    };
	    result._emitter.addText(code);
	    return result;
	  }

	  /**
	  Highlighting with language detection. Accepts a string with the code to
	  highlight. Returns an object with the following properties:

	  - language (detected language)
	  - relevance (int)
	  - value (an HTML string with highlighting markup)
	  - secondBest (object with the same structure for second-best heuristically
	    detected language, may be absent)

	    @param {string} code
	    @param {Array<string>} [languageSubset]
	    @returns {AutoHighlightResult}
	  */
	  function highlightAuto(code, languageSubset) {
	    languageSubset = languageSubset || options.languages || Object.keys(languages);
	    const plaintext = justTextHighlightResult(code);

	    const results = languageSubset.filter(getLanguage).filter(autoDetection).map(name =>
	      _highlight(name, code, false)
	    );
	    results.unshift(plaintext); // plaintext is always an option

	    const sorted = results.sort((a, b) => {
	      // sort base on relevance
	      if (a.relevance !== b.relevance) return b.relevance - a.relevance;

	      // always award the tie to the base language
	      // ie if C++ and Arduino are tied, it's more likely to be C++
	      if (a.language && b.language) {
	        if (getLanguage(a.language).supersetOf === b.language) {
	          return 1;
	        } else if (getLanguage(b.language).supersetOf === a.language) {
	          return -1;
	        }
	      }

	      // otherwise say they are equal, which has the effect of sorting on
	      // relevance while preserving the original ordering - which is how ties
	      // have historically been settled, ie the language that comes first always
	      // wins in the case of a tie
	      return 0;
	    });

	    const [best, secondBest] = sorted;

	    /** @type {AutoHighlightResult} */
	    const result = best;
	    result.secondBest = secondBest;

	    return result;
	  }

	  /**
	   * Builds new class name for block given the language name
	   *
	   * @param {HTMLElement} element
	   * @param {string} [currentLang]
	   * @param {string} [resultLang]
	   */
	  function updateClassName(element, currentLang, resultLang) {
	    const language = (currentLang && aliases[currentLang]) || resultLang;

	    element.classList.add("hljs");
	    element.classList.add(`language-${language}`);
	  }

	  /**
	   * Applies highlighting to a DOM node containing code.
	   *
	   * @param {HighlightedHTMLElement} element - the HTML element to highlight
	  */
	  function highlightElement(element) {
	    /** @type HTMLElement */
	    let node = null;
	    const language = blockLanguage(element);

	    if (shouldNotHighlight(language)) return;

	    fire("before:highlightElement",
	      { el: element, language });

	    if (element.dataset.highlighted) {
	      console.log("Element previously highlighted. To highlight again, first unset `dataset.highlighted`.", element);
	      return;
	    }

	    // we should be all text, no child nodes (unescaped HTML) - this is possibly
	    // an HTML injection attack - it's likely too late if this is already in
	    // production (the code has likely already done its damage by the time
	    // we're seeing it)... but we yell loudly about this so that hopefully it's
	    // more likely to be caught in development before making it to production
	    if (element.children.length > 0) {
	      if (!options.ignoreUnescapedHTML) {
	        console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk.");
	        console.warn("https://github.com/highlightjs/highlight.js/wiki/security");
	        console.warn("The element with unescaped HTML:");
	        console.warn(element);
	      }
	      if (options.throwUnescapedHTML) {
	        const err = new HTMLInjectionError(
	          "One of your code blocks includes unescaped HTML.",
	          element.innerHTML
	        );
	        throw err;
	      }
	    }

	    node = element;
	    const text = node.textContent;
	    const result = language ? highlight(text, { language, ignoreIllegals: true }) : highlightAuto(text);

	    element.innerHTML = result.value;
	    element.dataset.highlighted = "yes";
	    updateClassName(element, language, result.language);
	    element.result = {
	      language: result.language,
	      // TODO: remove with version 11.0
	      re: result.relevance,
	      relevance: result.relevance
	    };
	    if (result.secondBest) {
	      element.secondBest = {
	        language: result.secondBest.language,
	        relevance: result.secondBest.relevance
	      };
	    }

	    fire("after:highlightElement", { el: element, result, text });
	  }

	  /**
	   * Updates highlight.js global options with the passed options
	   *
	   * @param {Partial<HLJSOptions>} userOptions
	   */
	  function configure(userOptions) {
	    options = inherit(options, userOptions);
	  }

	  // TODO: remove v12, deprecated
	  const initHighlighting = () => {
	    highlightAll();
	    deprecated("10.6.0", "initHighlighting() deprecated.  Use highlightAll() now.");
	  };

	  // TODO: remove v12, deprecated
	  function initHighlightingOnLoad() {
	    highlightAll();
	    deprecated("10.6.0", "initHighlightingOnLoad() deprecated.  Use highlightAll() now.");
	  }

	  let wantsHighlight = false;

	  /**
	   * auto-highlights all pre>code elements on the page
	   */
	  function highlightAll() {
	    function boot() {
	      // if a highlight was requested before DOM was loaded, do now
	      highlightAll();
	    }

	    // if we are called too early in the loading process
	    if (document.readyState === "loading") {
	      // make sure the event listener is only added once
	      if (!wantsHighlight) {
	        window.addEventListener('DOMContentLoaded', boot, false);
	      }
	      wantsHighlight = true;
	      return;
	    }

	    const blocks = document.querySelectorAll(options.cssSelector);
	    blocks.forEach(highlightElement);
	  }

	  /**
	   * Register a language grammar module
	   *
	   * @param {string} languageName
	   * @param {LanguageFn} languageDefinition
	   */
	  function registerLanguage(languageName, languageDefinition) {
	    let lang = null;
	    try {
	      lang = languageDefinition(hljs);
	    } catch (error$1) {
	      error("Language definition for '{}' could not be registered.".replace("{}", languageName));
	      // hard or soft error
	      if (!SAFE_MODE) { throw error$1; } else { error(error$1); }
	      // languages that have serious errors are replaced with essentially a
	      // "plaintext" stand-in so that the code blocks will still get normal
	      // css classes applied to them - and one bad language won't break the
	      // entire highlighter
	      lang = PLAINTEXT_LANGUAGE;
	    }
	    // give it a temporary name if it doesn't have one in the meta-data
	    if (!lang.name) lang.name = languageName;
	    languages[languageName] = lang;
	    lang.rawDefinition = languageDefinition.bind(null, hljs);

	    if (lang.aliases) {
	      registerAliases(lang.aliases, { languageName });
	    }
	  }

	  /**
	   * Remove a language grammar module
	   *
	   * @param {string} languageName
	   */
	  function unregisterLanguage(languageName) {
	    delete languages[languageName];
	    for (const alias of Object.keys(aliases)) {
	      if (aliases[alias] === languageName) {
	        delete aliases[alias];
	      }
	    }
	  }

	  /**
	   * @returns {string[]} List of language internal names
	   */
	  function listLanguages() {
	    return Object.keys(languages);
	  }

	  /**
	   * @param {string} name - name of the language to retrieve
	   * @returns {Language | undefined}
	   */
	  function getLanguage(name) {
	    name = (name || '').toLowerCase();
	    return languages[name] || languages[aliases[name]];
	  }

	  /**
	   *
	   * @param {string|string[]} aliasList - single alias or list of aliases
	   * @param {{languageName: string}} opts
	   */
	  function registerAliases(aliasList, { languageName }) {
	    if (typeof aliasList === 'string') {
	      aliasList = [aliasList];
	    }
	    aliasList.forEach(alias => { aliases[alias.toLowerCase()] = languageName; });
	  }

	  /**
	   * Determines if a given language has auto-detection enabled
	   * @param {string} name - name of the language
	   */
	  function autoDetection(name) {
	    const lang = getLanguage(name);
	    return lang && !lang.disableAutodetect;
	  }

	  /**
	   * Upgrades the old highlightBlock plugins to the new
	   * highlightElement API
	   * @param {HLJSPlugin} plugin
	   */
	  function upgradePluginAPI(plugin) {
	    // TODO: remove with v12
	    if (plugin["before:highlightBlock"] && !plugin["before:highlightElement"]) {
	      plugin["before:highlightElement"] = (data) => {
	        plugin["before:highlightBlock"](
	          Object.assign({ block: data.el }, data)
	        );
	      };
	    }
	    if (plugin["after:highlightBlock"] && !plugin["after:highlightElement"]) {
	      plugin["after:highlightElement"] = (data) => {
	        plugin["after:highlightBlock"](
	          Object.assign({ block: data.el }, data)
	        );
	      };
	    }
	  }

	  /**
	   * @param {HLJSPlugin} plugin
	   */
	  function addPlugin(plugin) {
	    upgradePluginAPI(plugin);
	    plugins.push(plugin);
	  }

	  /**
	   * @param {HLJSPlugin} plugin
	   */
	  function removePlugin(plugin) {
	    const index = plugins.indexOf(plugin);
	    if (index !== -1) {
	      plugins.splice(index, 1);
	    }
	  }

	  /**
	   *
	   * @param {PluginEvent} event
	   * @param {any} args
	   */
	  function fire(event, args) {
	    const cb = event;
	    plugins.forEach(function(plugin) {
	      if (plugin[cb]) {
	        plugin[cb](args);
	      }
	    });
	  }

	  /**
	   * DEPRECATED
	   * @param {HighlightedHTMLElement} el
	   */
	  function deprecateHighlightBlock(el) {
	    deprecated("10.7.0", "highlightBlock will be removed entirely in v12.0");
	    deprecated("10.7.0", "Please use highlightElement now.");

	    return highlightElement(el);
	  }

	  /* Interface definition */
	  Object.assign(hljs, {
	    highlight,
	    highlightAuto,
	    highlightAll,
	    highlightElement,
	    // TODO: Remove with v12 API
	    highlightBlock: deprecateHighlightBlock,
	    configure,
	    initHighlighting,
	    initHighlightingOnLoad,
	    registerLanguage,
	    unregisterLanguage,
	    listLanguages,
	    getLanguage,
	    registerAliases,
	    autoDetection,
	    inherit,
	    addPlugin,
	    removePlugin
	  });

	  hljs.debugMode = function() { SAFE_MODE = false; };
	  hljs.safeMode = function() { SAFE_MODE = true; };
	  hljs.versionString = version;

	  hljs.regex = {
	    concat: concat,
	    lookahead: lookahead,
	    either: either,
	    optional: optional,
	    anyNumberOfTimes: anyNumberOfTimes
	  };

	  for (const key in MODES) {
	    // @ts-ignore
	    if (typeof MODES[key] === "object") {
	      // @ts-ignore
	      deepFreeze(MODES[key]);
	    }
	  }

	  // merge all the modes/regexes into our main object
	  Object.assign(hljs, MODES);

	  return hljs;
	};

	// Other names for the variable may break build script
	const highlight = HLJS({});

	// returns a new instance of the highlighter to be used for extensions
	// check https://github.com/wooorm/lowlight/issues/47
	highlight.newInstance = () => HLJS({});

	core = highlight;
	highlight.HighlightJS = highlight;
	highlight.default = highlight;
	return core;
}

var coreExports = /*@__PURE__*/ requireCore();
const HighlightJS = /*@__PURE__*/getDefaultExportFromCjs(coreExports);

// https://nodejs.org/api/packages.html#packages_writing_dual_packages_while_avoiding_or_minimizing_hazards

const IDENT_RE$1 = '[A-Za-z$_][0-9A-Za-z$_]*';
const KEYWORDS$1 = [
  "as", // for exports
  "in",
  "of",
  "if",
  "for",
  "while",
  "finally",
  "var",
  "new",
  "function",
  "do",
  "return",
  "void",
  "else",
  "break",
  "catch",
  "instanceof",
  "with",
  "throw",
  "case",
  "default",
  "try",
  "switch",
  "continue",
  "typeof",
  "delete",
  "let",
  "yield",
  "const",
  "class",
  // JS handles these with a special rule
  // "get",
  // "set",
  "debugger",
  "async",
  "await",
  "static",
  "import",
  "from",
  "export",
  "extends",
  // It's reached stage 3, which is "recommended for implementation":
  "using"
];
const LITERALS$1 = [
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity"
];

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
const TYPES$1 = [
  // Fundamental objects
  "Object",
  "Function",
  "Boolean",
  "Symbol",
  // numbers and dates
  "Math",
  "Date",
  "Number",
  "BigInt",
  // text
  "String",
  "RegExp",
  // Indexed collections
  "Array",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Int32Array",
  "Uint16Array",
  "Uint32Array",
  "BigInt64Array",
  "BigUint64Array",
  // Keyed collections
  "Set",
  "Map",
  "WeakSet",
  "WeakMap",
  // Structured data
  "ArrayBuffer",
  "SharedArrayBuffer",
  "Atomics",
  "DataView",
  "JSON",
  // Control abstraction objects
  "Promise",
  "Generator",
  "GeneratorFunction",
  "AsyncFunction",
  // Reflection
  "Reflect",
  "Proxy",
  // Internationalization
  "Intl",
  // WebAssembly
  "WebAssembly"
];

const ERROR_TYPES$1 = [
  "Error",
  "EvalError",
  "InternalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError"
];

const BUILT_IN_GLOBALS$1 = [
  "setInterval",
  "setTimeout",
  "clearInterval",
  "clearTimeout",

  "require",
  "exports",

  "eval",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape"
];

const BUILT_IN_VARIABLES$1 = [
  "arguments",
  "this",
  "super",
  "console",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "module",
  "global" // Node.js
];

const BUILT_INS$1 = [].concat(
  BUILT_IN_GLOBALS$1,
  TYPES$1,
  ERROR_TYPES$1
);

/*
Language: JavaScript
Description: JavaScript (JS) is a lightweight, interpreted, or just-in-time compiled programming language with first-class functions.
Category: common, scripting, web
Website: https://developer.mozilla.org/en-US/docs/Web/JavaScript
*/


/** @type LanguageFn */
function javascript$1(hljs) {
  const regex = hljs.regex;
  /**
   * Takes a string like "<Booger" and checks to see
   * if we can find a matching "</Booger" later in the
   * content.
   * @param {RegExpMatchArray} match
   * @param {{after:number}} param1
   */
  const hasClosingTag = (match, { after }) => {
    const tag = "</" + match[0].slice(1);
    const pos = match.input.indexOf(tag, after);
    return pos !== -1;
  };

  const IDENT_RE$1$1 = IDENT_RE$1;
  const FRAGMENT = {
    begin: '<>',
    end: '</>'
  };
  // to avoid some special cases inside isTrulyOpeningTag
  const XML_SELF_CLOSING = /<[A-Za-z0-9\\._:-]+\s*\/>/;
  const XML_TAG = {
    begin: /<[A-Za-z0-9\\._:-]+/,
    end: /\/[A-Za-z0-9\\._:-]+>|\/>/,
    /**
     * @param {RegExpMatchArray} match
     * @param {CallbackResponse} response
     */
    isTrulyOpeningTag: (match, response) => {
      const afterMatchIndex = match[0].length + match.index;
      const nextChar = match.input[afterMatchIndex];
      if (
        // HTML should not include another raw `<` inside a tag
        // nested type?
        // `<Array<Array<number>>`, etc.
        nextChar === "<" ||
        // the , gives away that this is not HTML
        // `<T, A extends keyof T, V>`
        nextChar === ","
        ) {
        response.ignoreMatch();
        return;
      }

      // `<something>`
      // Quite possibly a tag, lets look for a matching closing tag...
      if (nextChar === ">") {
        // if we cannot find a matching closing tag, then we
        // will ignore it
        if (!hasClosingTag(match, { after: afterMatchIndex })) {
          response.ignoreMatch();
        }
      }

      // `<blah />` (self-closing)
      // handled by simpleSelfClosing rule

      let m;
      const afterMatch = match.input.substring(afterMatchIndex);

      // some more template typing stuff
      //  <T = any>(key?: string) => Modify<
      if ((m = afterMatch.match(/^\s*=/))) {
        response.ignoreMatch();
        return;
      }

      // `<From extends string>`
      // technically this could be HTML, but it smells like a type
      // NOTE: This is ugh, but added specifically for https://github.com/highlightjs/highlight.js/issues/3276
      if ((m = afterMatch.match(/^\s+extends\s+/))) {
        if (m.index === 0) {
          response.ignoreMatch();
          // eslint-disable-next-line no-useless-return
          return;
        }
      }
    }
  };
  const KEYWORDS$1$1 = {
    $pattern: IDENT_RE$1,
    keyword: KEYWORDS$1,
    literal: LITERALS$1,
    built_in: BUILT_INS$1,
    "variable.language": BUILT_IN_VARIABLES$1
  };

  // https://tc39.es/ecma262/#sec-literals-numeric-literals
  const decimalDigits = '[0-9](_?[0-9])*';
  const frac = `\\.(${decimalDigits})`;
  // DecimalIntegerLiteral, including Annex B NonOctalDecimalIntegerLiteral
  // https://tc39.es/ecma262/#sec-additional-syntax-numeric-literals
  const decimalInteger = `0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*`;
  const NUMBER = {
    className: 'number',
    variants: [
      // DecimalLiteral
      { begin: `(\\b(${decimalInteger})((${frac})|\\.)?|(${frac}))` +
        `[eE][+-]?(${decimalDigits})\\b` },
      { begin: `\\b(${decimalInteger})\\b((${frac})\\b|\\.)?|(${frac})\\b` },

      // DecimalBigIntegerLiteral
      { begin: `\\b(0|[1-9](_?[0-9])*)n\\b` },

      // NonDecimalIntegerLiteral
      { begin: "\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b" },
      { begin: "\\b0[bB][0-1](_?[0-1])*n?\\b" },
      { begin: "\\b0[oO][0-7](_?[0-7])*n?\\b" },

      // LegacyOctalIntegerLiteral (does not include underscore separators)
      // https://tc39.es/ecma262/#sec-additional-syntax-numeric-literals
      { begin: "\\b0[0-7]+n?\\b" },
    ],
    relevance: 0
  };

  const SUBST = {
    className: 'subst',
    begin: '\\$\\{',
    end: '\\}',
    keywords: KEYWORDS$1$1,
    contains: [] // defined later
  };
  const HTML_TEMPLATE = {
    begin: '\.?html`',
    end: '',
    starts: {
      end: '`',
      returnEnd: false,
      contains: [
        hljs.BACKSLASH_ESCAPE,
        SUBST
      ],
      subLanguage: 'xml'
    }
  };
  const CSS_TEMPLATE = {
    begin: '\.?css`',
    end: '',
    starts: {
      end: '`',
      returnEnd: false,
      contains: [
        hljs.BACKSLASH_ESCAPE,
        SUBST
      ],
      subLanguage: 'css'
    }
  };
  const GRAPHQL_TEMPLATE = {
    begin: '\.?gql`',
    end: '',
    starts: {
      end: '`',
      returnEnd: false,
      contains: [
        hljs.BACKSLASH_ESCAPE,
        SUBST
      ],
      subLanguage: 'graphql'
    }
  };
  const TEMPLATE_STRING = {
    className: 'string',
    begin: '`',
    end: '`',
    contains: [
      hljs.BACKSLASH_ESCAPE,
      SUBST
    ]
  };
  const JSDOC_COMMENT = hljs.COMMENT(
    /\/\*\*(?!\/)/,
    '\\*/',
    {
      relevance: 0,
      contains: [
        {
          begin: '(?=@[A-Za-z]+)',
          relevance: 0,
          contains: [
            {
              className: 'doctag',
              begin: '@[A-Za-z]+'
            },
            {
              className: 'type',
              begin: '\\{',
              end: '\\}',
              excludeEnd: true,
              excludeBegin: true,
              relevance: 0
            },
            {
              className: 'variable',
              begin: IDENT_RE$1$1 + '(?=\\s*(-)|$)',
              endsParent: true,
              relevance: 0
            },
            // eat spaces (not newlines) so we can find
            // types or variables
            {
              begin: /(?=[^\n])\s/,
              relevance: 0
            }
          ]
        }
      ]
    }
  );
  const COMMENT = {
    className: "comment",
    variants: [
      JSDOC_COMMENT,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE
    ]
  };
  const SUBST_INTERNALS = [
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    HTML_TEMPLATE,
    CSS_TEMPLATE,
    GRAPHQL_TEMPLATE,
    TEMPLATE_STRING,
    // Skip numbers when they are part of a variable name
    { match: /\$\d+/ },
    NUMBER,
    // This is intentional:
    // See https://github.com/highlightjs/highlight.js/issues/3288
    // hljs.REGEXP_MODE
  ];
  SUBST.contains = SUBST_INTERNALS
    .concat({
      // we need to pair up {} inside our subst to prevent
      // it from ending too early by matching another }
      begin: /\{/,
      end: /\}/,
      keywords: KEYWORDS$1$1,
      contains: [
        "self"
      ].concat(SUBST_INTERNALS)
    });
  const SUBST_AND_COMMENTS = [].concat(COMMENT, SUBST.contains);
  const PARAMS_CONTAINS = SUBST_AND_COMMENTS.concat([
    // eat recursive parens in sub expressions
    {
      begin: /(\s*)\(/,
      end: /\)/,
      keywords: KEYWORDS$1$1,
      contains: ["self"].concat(SUBST_AND_COMMENTS)
    }
  ]);
  const PARAMS = {
    className: 'params',
    // convert this to negative lookbehind in v12
    begin: /(\s*)\(/, // to match the parms with
    end: /\)/,
    excludeBegin: true,
    excludeEnd: true,
    keywords: KEYWORDS$1$1,
    contains: PARAMS_CONTAINS
  };

  // ES6 classes
  const CLASS_OR_EXTENDS = {
    variants: [
      // class Car extends vehicle
      {
        match: [
          /class/,
          /\s+/,
          IDENT_RE$1$1,
          /\s+/,
          /extends/,
          /\s+/,
          regex.concat(IDENT_RE$1$1, "(", regex.concat(/\./, IDENT_RE$1$1), ")*")
        ],
        scope: {
          1: "keyword",
          3: "title.class",
          5: "keyword",
          7: "title.class.inherited"
        }
      },
      // class Car
      {
        match: [
          /class/,
          /\s+/,
          IDENT_RE$1$1
        ],
        scope: {
          1: "keyword",
          3: "title.class"
        }
      },

    ]
  };

  const CLASS_REFERENCE = {
    relevance: 0,
    match:
    regex.either(
      // Hard coded exceptions
      /\bJSON/,
      // Float32Array, OutT
      /\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,
      // CSSFactory, CSSFactoryT
      /\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,
      // FPs, FPsT
      /\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/,
      // P
      // single letters are not highlighted
      // BLAH
      // this will be flagged as a UPPER_CASE_CONSTANT instead
    ),
    className: "title.class",
    keywords: {
      _: [
        // se we still get relevance credit for JS library classes
        ...TYPES$1,
        ...ERROR_TYPES$1
      ]
    }
  };

  const USE_STRICT = {
    label: "use_strict",
    className: 'meta',
    relevance: 10,
    begin: /^\s*['"]use (strict|asm)['"]/
  };

  const FUNCTION_DEFINITION = {
    variants: [
      {
        match: [
          /function/,
          /\s+/,
          IDENT_RE$1$1,
          /(?=\s*\()/
        ]
      },
      // anonymous function
      {
        match: [
          /function/,
          /\s*(?=\()/
        ]
      }
    ],
    className: {
      1: "keyword",
      3: "title.function"
    },
    label: "func.def",
    contains: [ PARAMS ],
    illegal: /%/
  };

  const UPPER_CASE_CONSTANT = {
    relevance: 0,
    match: /\b[A-Z][A-Z_0-9]+\b/,
    className: "variable.constant"
  };

  function noneOf(list) {
    return regex.concat("(?!", list.join("|"), ")");
  }

  const FUNCTION_CALL = {
    match: regex.concat(
      /\b/,
      noneOf([
        ...BUILT_IN_GLOBALS$1,
        "super",
        "import"
      ].map(x => `${x}\\s*\\(`)),
      IDENT_RE$1$1, regex.lookahead(/\s*\(/)),
    className: "title.function",
    relevance: 0
  };

  const PROPERTY_ACCESS = {
    begin: regex.concat(/\./, regex.lookahead(
      regex.concat(IDENT_RE$1$1, /(?![0-9A-Za-z$_(])/)
    )),
    end: IDENT_RE$1$1,
    excludeBegin: true,
    keywords: "prototype",
    className: "property",
    relevance: 0
  };

  const GETTER_OR_SETTER = {
    match: [
      /get|set/,
      /\s+/,
      IDENT_RE$1$1,
      /(?=\()/
    ],
    className: {
      1: "keyword",
      3: "title.function"
    },
    contains: [
      { // eat to avoid empty params
        begin: /\(\)/
      },
      PARAMS
    ]
  };

  const FUNC_LEAD_IN_RE = '(\\(' +
    '[^()]*(\\(' +
    '[^()]*(\\(' +
    '[^()]*' +
    '\\)[^()]*)*' +
    '\\)[^()]*)*' +
    '\\)|' + hljs.UNDERSCORE_IDENT_RE + ')\\s*=>';

  const FUNCTION_VARIABLE = {
    match: [
      /const|var|let/, /\s+/,
      IDENT_RE$1$1, /\s*/,
      /=\s*/,
      /(async\s*)?/, // async is optional
      regex.lookahead(FUNC_LEAD_IN_RE)
    ],
    keywords: "async",
    className: {
      1: "keyword",
      3: "title.function"
    },
    contains: [
      PARAMS
    ]
  };

  return {
    name: 'JavaScript',
    aliases: ['js', 'jsx', 'mjs', 'cjs'],
    keywords: KEYWORDS$1$1,
    // this will be extended by TypeScript
    exports: { PARAMS_CONTAINS, CLASS_REFERENCE },
    illegal: /#(?![$_A-z])/,
    contains: [
      hljs.SHEBANG({
        label: "shebang",
        binary: "node",
        relevance: 5
      }),
      USE_STRICT,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      HTML_TEMPLATE,
      CSS_TEMPLATE,
      GRAPHQL_TEMPLATE,
      TEMPLATE_STRING,
      COMMENT,
      // Skip numbers when they are part of a variable name
      { match: /\$\d+/ },
      NUMBER,
      CLASS_REFERENCE,
      {
        scope: 'attr',
        match: IDENT_RE$1$1 + regex.lookahead(':'),
        relevance: 0
      },
      FUNCTION_VARIABLE,
      { // "value" container
        begin: '(' + hljs.RE_STARTERS_RE + '|\\b(case|return|throw)\\b)\\s*',
        keywords: 'return throw case',
        relevance: 0,
        contains: [
          COMMENT,
          hljs.REGEXP_MODE,
          {
            className: 'function',
            // we have to count the parens to make sure we actually have the
            // correct bounding ( ) before the =>.  There could be any number of
            // sub-expressions inside also surrounded by parens.
            begin: FUNC_LEAD_IN_RE,
            returnBegin: true,
            end: '\\s*=>',
            contains: [
              {
                className: 'params',
                variants: [
                  {
                    begin: hljs.UNDERSCORE_IDENT_RE,
                    relevance: 0
                  },
                  {
                    className: null,
                    begin: /\(\s*\)/,
                    skip: true
                  },
                  {
                    begin: /(\s*)\(/,
                    end: /\)/,
                    excludeBegin: true,
                    excludeEnd: true,
                    keywords: KEYWORDS$1$1,
                    contains: PARAMS_CONTAINS
                  }
                ]
              }
            ]
          },
          { // could be a comma delimited list of params to a function call
            begin: /,/,
            relevance: 0
          },
          {
            match: /\s+/,
            relevance: 0
          },
          { // JSX
            variants: [
              { begin: FRAGMENT.begin, end: FRAGMENT.end },
              { match: XML_SELF_CLOSING },
              {
                begin: XML_TAG.begin,
                // we carefully check the opening tag to see if it truly
                // is a tag and not a false positive
                'on:begin': XML_TAG.isTrulyOpeningTag,
                end: XML_TAG.end
              }
            ],
            subLanguage: 'xml',
            contains: [
              {
                begin: XML_TAG.begin,
                end: XML_TAG.end,
                skip: true,
                contains: ['self']
              }
            ]
          }
        ],
      },
      FUNCTION_DEFINITION,
      {
        // prevent this from getting swallowed up by function
        // since they appear "function like"
        beginKeywords: "while if switch catch for"
      },
      {
        // we have to count the parens to make sure we actually have the correct
        // bounding ( ).  There could be any number of sub-expressions inside
        // also surrounded by parens.
        begin: '\\b(?!function)' + hljs.UNDERSCORE_IDENT_RE +
          '\\(' + // first parens
          '[^()]*(\\(' +
            '[^()]*(\\(' +
              '[^()]*' +
            '\\)[^()]*)*' +
          '\\)[^()]*)*' +
          '\\)\\s*\\{', // end parens
        returnBegin:true,
        label: "func.def",
        contains: [
          PARAMS,
          hljs.inherit(hljs.TITLE_MODE, { begin: IDENT_RE$1$1, className: "title.function" })
        ]
      },
      // catch ... so it won't trigger the property rule below
      {
        match: /\.\.\./,
        relevance: 0
      },
      PROPERTY_ACCESS,
      // hack: prevents detection of keywords in some circumstances
      // .keyword()
      // $keyword = x
      {
        match: '\\$' + IDENT_RE$1$1,
        relevance: 0
      },
      {
        match: [ /\bconstructor(?=\s*\()/ ],
        className: { 1: "title.function" },
        contains: [ PARAMS ]
      },
      FUNCTION_CALL,
      UPPER_CASE_CONSTANT,
      CLASS_OR_EXTENDS,
      GETTER_OR_SETTER,
      {
        match: /\$[(.]/ // relevance booster for a pattern common to JS libs: `$(something)` and `$.something`
      }
    ]
  };
}

/*
Language: TypeScript
Author: Panu Horsmalahti <panu.horsmalahti@iki.fi>
Contributors: Ike Ku <dempfi@yahoo.com>
Description: TypeScript is a strict superset of JavaScript
Website: https://www.typescriptlang.org
Category: common, scripting
*/


/** @type LanguageFn */
function typescript(hljs) {
  const regex = hljs.regex;
  const tsLanguage = javascript$1(hljs);

  const IDENT_RE$1$1 = IDENT_RE$1;
  const TYPES = [
    "any",
    "void",
    "number",
    "boolean",
    "string",
    "object",
    "never",
    "symbol",
    "bigint",
    "unknown"
  ];
  const NAMESPACE = {
    begin: [
      /namespace/,
      /\s+/,
      hljs.IDENT_RE
    ],
    beginScope: {
      1: "keyword",
      3: "title.class"
    }
  };
  const INTERFACE = {
    beginKeywords: 'interface',
    end: /\{/,
    excludeEnd: true,
    keywords: {
      keyword: 'interface extends',
      built_in: TYPES
    },
    contains: [ tsLanguage.exports.CLASS_REFERENCE ]
  };
  const USE_STRICT = {
    className: 'meta',
    relevance: 10,
    begin: /^\s*['"]use strict['"]/
  };
  const TS_SPECIFIC_KEYWORDS = [
    "type",
    // "namespace",
    "interface",
    "public",
    "private",
    "protected",
    "implements",
    "declare",
    "abstract",
    "readonly",
    "enum",
    "override",
    "satisfies"
  ];
  /*
    namespace is a TS keyword but it's fine to use it as a variable name too.
    const message = 'foo';
    const namespace = 'bar';
  */
  const KEYWORDS$1$1 = {
    $pattern: IDENT_RE$1,
    keyword: KEYWORDS$1.concat(TS_SPECIFIC_KEYWORDS),
    literal: LITERALS$1,
    built_in: BUILT_INS$1.concat(TYPES),
    "variable.language": BUILT_IN_VARIABLES$1
  };

  const DECORATOR = {
    className: 'meta',
    begin: '@' + IDENT_RE$1$1,
  };

  const swapMode = (mode, label, replacement) => {
    const indx = mode.contains.findIndex(m => m.label === label);
    if (indx === -1) { throw new Error("can not find mode to replace"); }

    mode.contains.splice(indx, 1, replacement);
  };


  // this should update anywhere keywords is used since
  // it will be the same actual JS object
  Object.assign(tsLanguage.keywords, KEYWORDS$1$1);

  tsLanguage.exports.PARAMS_CONTAINS.push(DECORATOR);

  // highlight the function params
  const ATTRIBUTE_HIGHLIGHT = tsLanguage.contains.find(c => c.scope === "attr");

  // take default attr rule and extend it to support optionals
  const OPTIONAL_KEY_OR_ARGUMENT = Object.assign({},
    ATTRIBUTE_HIGHLIGHT,
    { match: regex.concat(IDENT_RE$1$1, regex.lookahead(/\s*\?:/)) }
  );
  tsLanguage.exports.PARAMS_CONTAINS.push([
    tsLanguage.exports.CLASS_REFERENCE, // class reference for highlighting the params types
    ATTRIBUTE_HIGHLIGHT, // highlight the params key
    OPTIONAL_KEY_OR_ARGUMENT, // Added for optional property assignment highlighting
  ]);

  // Add the optional property assignment highlighting for objects or classes
  tsLanguage.contains = tsLanguage.contains.concat([
    DECORATOR,
    NAMESPACE,
    INTERFACE,
    OPTIONAL_KEY_OR_ARGUMENT, // Added for optional property assignment highlighting
  ]);

  // TS gets a simpler shebang rule than JS
  swapMode(tsLanguage, "shebang", hljs.SHEBANG());
  // JS use strict rule purposely excludes `asm` which makes no sense
  swapMode(tsLanguage, "use_strict", USE_STRICT);

  const functionDeclaration = tsLanguage.contains.find(m => m.label === "func.def");
  functionDeclaration.relevance = 0; // () => {} is more typical in TypeScript

  Object.assign(tsLanguage, {
    name: 'TypeScript',
    aliases: [
      'ts',
      'tsx',
      'mts',
      'cts'
    ]
  });

  return tsLanguage;
}

const IDENT_RE = '[A-Za-z$_][0-9A-Za-z$_]*';
const KEYWORDS = [
  "as", // for exports
  "in",
  "of",
  "if",
  "for",
  "while",
  "finally",
  "var",
  "new",
  "function",
  "do",
  "return",
  "void",
  "else",
  "break",
  "catch",
  "instanceof",
  "with",
  "throw",
  "case",
  "default",
  "try",
  "switch",
  "continue",
  "typeof",
  "delete",
  "let",
  "yield",
  "const",
  "class",
  // JS handles these with a special rule
  // "get",
  // "set",
  "debugger",
  "async",
  "await",
  "static",
  "import",
  "from",
  "export",
  "extends",
  // It's reached stage 3, which is "recommended for implementation":
  "using"
];
const LITERALS = [
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity"
];

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
const TYPES = [
  // Fundamental objects
  "Object",
  "Function",
  "Boolean",
  "Symbol",
  // numbers and dates
  "Math",
  "Date",
  "Number",
  "BigInt",
  // text
  "String",
  "RegExp",
  // Indexed collections
  "Array",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Int32Array",
  "Uint16Array",
  "Uint32Array",
  "BigInt64Array",
  "BigUint64Array",
  // Keyed collections
  "Set",
  "Map",
  "WeakSet",
  "WeakMap",
  // Structured data
  "ArrayBuffer",
  "SharedArrayBuffer",
  "Atomics",
  "DataView",
  "JSON",
  // Control abstraction objects
  "Promise",
  "Generator",
  "GeneratorFunction",
  "AsyncFunction",
  // Reflection
  "Reflect",
  "Proxy",
  // Internationalization
  "Intl",
  // WebAssembly
  "WebAssembly"
];

const ERROR_TYPES = [
  "Error",
  "EvalError",
  "InternalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError"
];

const BUILT_IN_GLOBALS = [
  "setInterval",
  "setTimeout",
  "clearInterval",
  "clearTimeout",

  "require",
  "exports",

  "eval",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape"
];

const BUILT_IN_VARIABLES = [
  "arguments",
  "this",
  "super",
  "console",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "module",
  "global" // Node.js
];

const BUILT_INS = [].concat(
  BUILT_IN_GLOBALS,
  TYPES,
  ERROR_TYPES
);

/*
Language: JavaScript
Description: JavaScript (JS) is a lightweight, interpreted, or just-in-time compiled programming language with first-class functions.
Category: common, scripting, web
Website: https://developer.mozilla.org/en-US/docs/Web/JavaScript
*/


/** @type LanguageFn */
function javascript(hljs) {
  const regex = hljs.regex;
  /**
   * Takes a string like "<Booger" and checks to see
   * if we can find a matching "</Booger" later in the
   * content.
   * @param {RegExpMatchArray} match
   * @param {{after:number}} param1
   */
  const hasClosingTag = (match, { after }) => {
    const tag = "</" + match[0].slice(1);
    const pos = match.input.indexOf(tag, after);
    return pos !== -1;
  };

  const IDENT_RE$1 = IDENT_RE;
  const FRAGMENT = {
    begin: '<>',
    end: '</>'
  };
  // to avoid some special cases inside isTrulyOpeningTag
  const XML_SELF_CLOSING = /<[A-Za-z0-9\\._:-]+\s*\/>/;
  const XML_TAG = {
    begin: /<[A-Za-z0-9\\._:-]+/,
    end: /\/[A-Za-z0-9\\._:-]+>|\/>/,
    /**
     * @param {RegExpMatchArray} match
     * @param {CallbackResponse} response
     */
    isTrulyOpeningTag: (match, response) => {
      const afterMatchIndex = match[0].length + match.index;
      const nextChar = match.input[afterMatchIndex];
      if (
        // HTML should not include another raw `<` inside a tag
        // nested type?
        // `<Array<Array<number>>`, etc.
        nextChar === "<" ||
        // the , gives away that this is not HTML
        // `<T, A extends keyof T, V>`
        nextChar === ","
        ) {
        response.ignoreMatch();
        return;
      }

      // `<something>`
      // Quite possibly a tag, lets look for a matching closing tag...
      if (nextChar === ">") {
        // if we cannot find a matching closing tag, then we
        // will ignore it
        if (!hasClosingTag(match, { after: afterMatchIndex })) {
          response.ignoreMatch();
        }
      }

      // `<blah />` (self-closing)
      // handled by simpleSelfClosing rule

      let m;
      const afterMatch = match.input.substring(afterMatchIndex);

      // some more template typing stuff
      //  <T = any>(key?: string) => Modify<
      if ((m = afterMatch.match(/^\s*=/))) {
        response.ignoreMatch();
        return;
      }

      // `<From extends string>`
      // technically this could be HTML, but it smells like a type
      // NOTE: This is ugh, but added specifically for https://github.com/highlightjs/highlight.js/issues/3276
      if ((m = afterMatch.match(/^\s+extends\s+/))) {
        if (m.index === 0) {
          response.ignoreMatch();
          // eslint-disable-next-line no-useless-return
          return;
        }
      }
    }
  };
  const KEYWORDS$1 = {
    $pattern: IDENT_RE,
    keyword: KEYWORDS,
    literal: LITERALS,
    built_in: BUILT_INS,
    "variable.language": BUILT_IN_VARIABLES
  };

  // https://tc39.es/ecma262/#sec-literals-numeric-literals
  const decimalDigits = '[0-9](_?[0-9])*';
  const frac = `\\.(${decimalDigits})`;
  // DecimalIntegerLiteral, including Annex B NonOctalDecimalIntegerLiteral
  // https://tc39.es/ecma262/#sec-additional-syntax-numeric-literals
  const decimalInteger = `0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*`;
  const NUMBER = {
    className: 'number',
    variants: [
      // DecimalLiteral
      { begin: `(\\b(${decimalInteger})((${frac})|\\.)?|(${frac}))` +
        `[eE][+-]?(${decimalDigits})\\b` },
      { begin: `\\b(${decimalInteger})\\b((${frac})\\b|\\.)?|(${frac})\\b` },

      // DecimalBigIntegerLiteral
      { begin: `\\b(0|[1-9](_?[0-9])*)n\\b` },

      // NonDecimalIntegerLiteral
      { begin: "\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b" },
      { begin: "\\b0[bB][0-1](_?[0-1])*n?\\b" },
      { begin: "\\b0[oO][0-7](_?[0-7])*n?\\b" },

      // LegacyOctalIntegerLiteral (does not include underscore separators)
      // https://tc39.es/ecma262/#sec-additional-syntax-numeric-literals
      { begin: "\\b0[0-7]+n?\\b" },
    ],
    relevance: 0
  };

  const SUBST = {
    className: 'subst',
    begin: '\\$\\{',
    end: '\\}',
    keywords: KEYWORDS$1,
    contains: [] // defined later
  };
  const HTML_TEMPLATE = {
    begin: '\.?html`',
    end: '',
    starts: {
      end: '`',
      returnEnd: false,
      contains: [
        hljs.BACKSLASH_ESCAPE,
        SUBST
      ],
      subLanguage: 'xml'
    }
  };
  const CSS_TEMPLATE = {
    begin: '\.?css`',
    end: '',
    starts: {
      end: '`',
      returnEnd: false,
      contains: [
        hljs.BACKSLASH_ESCAPE,
        SUBST
      ],
      subLanguage: 'css'
    }
  };
  const GRAPHQL_TEMPLATE = {
    begin: '\.?gql`',
    end: '',
    starts: {
      end: '`',
      returnEnd: false,
      contains: [
        hljs.BACKSLASH_ESCAPE,
        SUBST
      ],
      subLanguage: 'graphql'
    }
  };
  const TEMPLATE_STRING = {
    className: 'string',
    begin: '`',
    end: '`',
    contains: [
      hljs.BACKSLASH_ESCAPE,
      SUBST
    ]
  };
  const JSDOC_COMMENT = hljs.COMMENT(
    /\/\*\*(?!\/)/,
    '\\*/',
    {
      relevance: 0,
      contains: [
        {
          begin: '(?=@[A-Za-z]+)',
          relevance: 0,
          contains: [
            {
              className: 'doctag',
              begin: '@[A-Za-z]+'
            },
            {
              className: 'type',
              begin: '\\{',
              end: '\\}',
              excludeEnd: true,
              excludeBegin: true,
              relevance: 0
            },
            {
              className: 'variable',
              begin: IDENT_RE$1 + '(?=\\s*(-)|$)',
              endsParent: true,
              relevance: 0
            },
            // eat spaces (not newlines) so we can find
            // types or variables
            {
              begin: /(?=[^\n])\s/,
              relevance: 0
            }
          ]
        }
      ]
    }
  );
  const COMMENT = {
    className: "comment",
    variants: [
      JSDOC_COMMENT,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE
    ]
  };
  const SUBST_INTERNALS = [
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    HTML_TEMPLATE,
    CSS_TEMPLATE,
    GRAPHQL_TEMPLATE,
    TEMPLATE_STRING,
    // Skip numbers when they are part of a variable name
    { match: /\$\d+/ },
    NUMBER,
    // This is intentional:
    // See https://github.com/highlightjs/highlight.js/issues/3288
    // hljs.REGEXP_MODE
  ];
  SUBST.contains = SUBST_INTERNALS
    .concat({
      // we need to pair up {} inside our subst to prevent
      // it from ending too early by matching another }
      begin: /\{/,
      end: /\}/,
      keywords: KEYWORDS$1,
      contains: [
        "self"
      ].concat(SUBST_INTERNALS)
    });
  const SUBST_AND_COMMENTS = [].concat(COMMENT, SUBST.contains);
  const PARAMS_CONTAINS = SUBST_AND_COMMENTS.concat([
    // eat recursive parens in sub expressions
    {
      begin: /(\s*)\(/,
      end: /\)/,
      keywords: KEYWORDS$1,
      contains: ["self"].concat(SUBST_AND_COMMENTS)
    }
  ]);
  const PARAMS = {
    className: 'params',
    // convert this to negative lookbehind in v12
    begin: /(\s*)\(/, // to match the parms with
    end: /\)/,
    excludeBegin: true,
    excludeEnd: true,
    keywords: KEYWORDS$1,
    contains: PARAMS_CONTAINS
  };

  // ES6 classes
  const CLASS_OR_EXTENDS = {
    variants: [
      // class Car extends vehicle
      {
        match: [
          /class/,
          /\s+/,
          IDENT_RE$1,
          /\s+/,
          /extends/,
          /\s+/,
          regex.concat(IDENT_RE$1, "(", regex.concat(/\./, IDENT_RE$1), ")*")
        ],
        scope: {
          1: "keyword",
          3: "title.class",
          5: "keyword",
          7: "title.class.inherited"
        }
      },
      // class Car
      {
        match: [
          /class/,
          /\s+/,
          IDENT_RE$1
        ],
        scope: {
          1: "keyword",
          3: "title.class"
        }
      },

    ]
  };

  const CLASS_REFERENCE = {
    relevance: 0,
    match:
    regex.either(
      // Hard coded exceptions
      /\bJSON/,
      // Float32Array, OutT
      /\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,
      // CSSFactory, CSSFactoryT
      /\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,
      // FPs, FPsT
      /\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/,
      // P
      // single letters are not highlighted
      // BLAH
      // this will be flagged as a UPPER_CASE_CONSTANT instead
    ),
    className: "title.class",
    keywords: {
      _: [
        // se we still get relevance credit for JS library classes
        ...TYPES,
        ...ERROR_TYPES
      ]
    }
  };

  const USE_STRICT = {
    label: "use_strict",
    className: 'meta',
    relevance: 10,
    begin: /^\s*['"]use (strict|asm)['"]/
  };

  const FUNCTION_DEFINITION = {
    variants: [
      {
        match: [
          /function/,
          /\s+/,
          IDENT_RE$1,
          /(?=\s*\()/
        ]
      },
      // anonymous function
      {
        match: [
          /function/,
          /\s*(?=\()/
        ]
      }
    ],
    className: {
      1: "keyword",
      3: "title.function"
    },
    label: "func.def",
    contains: [ PARAMS ],
    illegal: /%/
  };

  const UPPER_CASE_CONSTANT = {
    relevance: 0,
    match: /\b[A-Z][A-Z_0-9]+\b/,
    className: "variable.constant"
  };

  function noneOf(list) {
    return regex.concat("(?!", list.join("|"), ")");
  }

  const FUNCTION_CALL = {
    match: regex.concat(
      /\b/,
      noneOf([
        ...BUILT_IN_GLOBALS,
        "super",
        "import"
      ].map(x => `${x}\\s*\\(`)),
      IDENT_RE$1, regex.lookahead(/\s*\(/)),
    className: "title.function",
    relevance: 0
  };

  const PROPERTY_ACCESS = {
    begin: regex.concat(/\./, regex.lookahead(
      regex.concat(IDENT_RE$1, /(?![0-9A-Za-z$_(])/)
    )),
    end: IDENT_RE$1,
    excludeBegin: true,
    keywords: "prototype",
    className: "property",
    relevance: 0
  };

  const GETTER_OR_SETTER = {
    match: [
      /get|set/,
      /\s+/,
      IDENT_RE$1,
      /(?=\()/
    ],
    className: {
      1: "keyword",
      3: "title.function"
    },
    contains: [
      { // eat to avoid empty params
        begin: /\(\)/
      },
      PARAMS
    ]
  };

  const FUNC_LEAD_IN_RE = '(\\(' +
    '[^()]*(\\(' +
    '[^()]*(\\(' +
    '[^()]*' +
    '\\)[^()]*)*' +
    '\\)[^()]*)*' +
    '\\)|' + hljs.UNDERSCORE_IDENT_RE + ')\\s*=>';

  const FUNCTION_VARIABLE = {
    match: [
      /const|var|let/, /\s+/,
      IDENT_RE$1, /\s*/,
      /=\s*/,
      /(async\s*)?/, // async is optional
      regex.lookahead(FUNC_LEAD_IN_RE)
    ],
    keywords: "async",
    className: {
      1: "keyword",
      3: "title.function"
    },
    contains: [
      PARAMS
    ]
  };

  return {
    name: 'JavaScript',
    aliases: ['js', 'jsx', 'mjs', 'cjs'],
    keywords: KEYWORDS$1,
    // this will be extended by TypeScript
    exports: { PARAMS_CONTAINS, CLASS_REFERENCE },
    illegal: /#(?![$_A-z])/,
    contains: [
      hljs.SHEBANG({
        label: "shebang",
        binary: "node",
        relevance: 5
      }),
      USE_STRICT,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      HTML_TEMPLATE,
      CSS_TEMPLATE,
      GRAPHQL_TEMPLATE,
      TEMPLATE_STRING,
      COMMENT,
      // Skip numbers when they are part of a variable name
      { match: /\$\d+/ },
      NUMBER,
      CLASS_REFERENCE,
      {
        scope: 'attr',
        match: IDENT_RE$1 + regex.lookahead(':'),
        relevance: 0
      },
      FUNCTION_VARIABLE,
      { // "value" container
        begin: '(' + hljs.RE_STARTERS_RE + '|\\b(case|return|throw)\\b)\\s*',
        keywords: 'return throw case',
        relevance: 0,
        contains: [
          COMMENT,
          hljs.REGEXP_MODE,
          {
            className: 'function',
            // we have to count the parens to make sure we actually have the
            // correct bounding ( ) before the =>.  There could be any number of
            // sub-expressions inside also surrounded by parens.
            begin: FUNC_LEAD_IN_RE,
            returnBegin: true,
            end: '\\s*=>',
            contains: [
              {
                className: 'params',
                variants: [
                  {
                    begin: hljs.UNDERSCORE_IDENT_RE,
                    relevance: 0
                  },
                  {
                    className: null,
                    begin: /\(\s*\)/,
                    skip: true
                  },
                  {
                    begin: /(\s*)\(/,
                    end: /\)/,
                    excludeBegin: true,
                    excludeEnd: true,
                    keywords: KEYWORDS$1,
                    contains: PARAMS_CONTAINS
                  }
                ]
              }
            ]
          },
          { // could be a comma delimited list of params to a function call
            begin: /,/,
            relevance: 0
          },
          {
            match: /\s+/,
            relevance: 0
          },
          { // JSX
            variants: [
              { begin: FRAGMENT.begin, end: FRAGMENT.end },
              { match: XML_SELF_CLOSING },
              {
                begin: XML_TAG.begin,
                // we carefully check the opening tag to see if it truly
                // is a tag and not a false positive
                'on:begin': XML_TAG.isTrulyOpeningTag,
                end: XML_TAG.end
              }
            ],
            subLanguage: 'xml',
            contains: [
              {
                begin: XML_TAG.begin,
                end: XML_TAG.end,
                skip: true,
                contains: ['self']
              }
            ]
          }
        ],
      },
      FUNCTION_DEFINITION,
      {
        // prevent this from getting swallowed up by function
        // since they appear "function like"
        beginKeywords: "while if switch catch for"
      },
      {
        // we have to count the parens to make sure we actually have the correct
        // bounding ( ).  There could be any number of sub-expressions inside
        // also surrounded by parens.
        begin: '\\b(?!function)' + hljs.UNDERSCORE_IDENT_RE +
          '\\(' + // first parens
          '[^()]*(\\(' +
            '[^()]*(\\(' +
              '[^()]*' +
            '\\)[^()]*)*' +
          '\\)[^()]*)*' +
          '\\)\\s*\\{', // end parens
        returnBegin:true,
        label: "func.def",
        contains: [
          PARAMS,
          hljs.inherit(hljs.TITLE_MODE, { begin: IDENT_RE$1, className: "title.function" })
        ]
      },
      // catch ... so it won't trigger the property rule below
      {
        match: /\.\.\./,
        relevance: 0
      },
      PROPERTY_ACCESS,
      // hack: prevents detection of keywords in some circumstances
      // .keyword()
      // $keyword = x
      {
        match: '\\$' + IDENT_RE$1,
        relevance: 0
      },
      {
        match: [ /\bconstructor(?=\s*\()/ ],
        className: { 1: "title.function" },
        contains: [ PARAMS ]
      },
      FUNCTION_CALL,
      UPPER_CASE_CONSTANT,
      CLASS_OR_EXTENDS,
      GETTER_OR_SETTER,
      {
        match: /\$[(.]/ // relevance booster for a pattern common to JS libs: `$(something)` and `$.something`
      }
    ]
  };
}

/*
Language: Python
Description: Python is an interpreted, object-oriented, high-level programming language with dynamic semantics.
Website: https://www.python.org
Category: common
*/

function python(hljs) {
  const regex = hljs.regex;
  const IDENT_RE = /[\p{XID_Start}_]\p{XID_Continue}*/u;
  const RESERVED_WORDS = [
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'case',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'match',
    'nonlocal|10',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield'
  ];

  const BUILT_INS = [
    '__import__',
    'abs',
    'all',
    'any',
    'ascii',
    'bin',
    'bool',
    'breakpoint',
    'bytearray',
    'bytes',
    'callable',
    'chr',
    'classmethod',
    'compile',
    'complex',
    'delattr',
    'dict',
    'dir',
    'divmod',
    'enumerate',
    'eval',
    'exec',
    'filter',
    'float',
    'format',
    'frozenset',
    'getattr',
    'globals',
    'hasattr',
    'hash',
    'help',
    'hex',
    'id',
    'input',
    'int',
    'isinstance',
    'issubclass',
    'iter',
    'len',
    'list',
    'locals',
    'map',
    'max',
    'memoryview',
    'min',
    'next',
    'object',
    'oct',
    'open',
    'ord',
    'pow',
    'print',
    'property',
    'range',
    'repr',
    'reversed',
    'round',
    'set',
    'setattr',
    'slice',
    'sorted',
    'staticmethod',
    'str',
    'sum',
    'super',
    'tuple',
    'type',
    'vars',
    'zip'
  ];

  const LITERALS = [
    '__debug__',
    'Ellipsis',
    'False',
    'None',
    'NotImplemented',
    'True'
  ];

  // https://docs.python.org/3/library/typing.html
  // TODO: Could these be supplemented by a CamelCase matcher in certain
  // contexts, leaving these remaining only for relevance hinting?
  const TYPES = [
    "Any",
    "Callable",
    "Coroutine",
    "Dict",
    "List",
    "Literal",
    "Generic",
    "Optional",
    "Sequence",
    "Set",
    "Tuple",
    "Type",
    "Union"
  ];

  const KEYWORDS = {
    $pattern: /[A-Za-z]\w+|__\w+__/,
    keyword: RESERVED_WORDS,
    built_in: BUILT_INS,
    literal: LITERALS,
    type: TYPES
  };

  const PROMPT = {
    className: 'meta',
    begin: /^(>>>|\.\.\.) /
  };

  const SUBST = {
    className: 'subst',
    begin: /\{/,
    end: /\}/,
    keywords: KEYWORDS,
    illegal: /#/
  };

  const LITERAL_BRACKET = {
    begin: /\{\{/,
    relevance: 0
  };

  const STRING = {
    className: 'string',
    contains: [ hljs.BACKSLASH_ESCAPE ],
    variants: [
      {
        begin: /([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,
        end: /'''/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          PROMPT
        ],
        relevance: 10
      },
      {
        begin: /([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,
        end: /"""/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          PROMPT
        ],
        relevance: 10
      },
      {
        begin: /([fF][rR]|[rR][fF]|[fF])'''/,
        end: /'''/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          PROMPT,
          LITERAL_BRACKET,
          SUBST
        ]
      },
      {
        begin: /([fF][rR]|[rR][fF]|[fF])"""/,
        end: /"""/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          PROMPT,
          LITERAL_BRACKET,
          SUBST
        ]
      },
      {
        begin: /([uU]|[rR])'/,
        end: /'/,
        relevance: 10
      },
      {
        begin: /([uU]|[rR])"/,
        end: /"/,
        relevance: 10
      },
      {
        begin: /([bB]|[bB][rR]|[rR][bB])'/,
        end: /'/
      },
      {
        begin: /([bB]|[bB][rR]|[rR][bB])"/,
        end: /"/
      },
      {
        begin: /([fF][rR]|[rR][fF]|[fF])'/,
        end: /'/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          LITERAL_BRACKET,
          SUBST
        ]
      },
      {
        begin: /([fF][rR]|[rR][fF]|[fF])"/,
        end: /"/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          LITERAL_BRACKET,
          SUBST
        ]
      },
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE
    ]
  };

  // https://docs.python.org/3.9/reference/lexical_analysis.html#numeric-literals
  const digitpart = '[0-9](_?[0-9])*';
  const pointfloat = `(\\b(${digitpart}))?\\.(${digitpart})|\\b(${digitpart})\\.`;
  // Whitespace after a number (or any lexical token) is needed only if its absence
  // would change the tokenization
  // https://docs.python.org/3.9/reference/lexical_analysis.html#whitespace-between-tokens
  // We deviate slightly, requiring a word boundary or a keyword
  // to avoid accidentally recognizing *prefixes* (e.g., `0` in `0x41` or `08` or `0__1`)
  const lookahead = `\\b|${RESERVED_WORDS.join('|')}`;
  const NUMBER = {
    className: 'number',
    relevance: 0,
    variants: [
      // exponentfloat, pointfloat
      // https://docs.python.org/3.9/reference/lexical_analysis.html#floating-point-literals
      // optionally imaginary
      // https://docs.python.org/3.9/reference/lexical_analysis.html#imaginary-literals
      // Note: no leading \b because floats can start with a decimal point
      // and we don't want to mishandle e.g. `fn(.5)`,
      // no trailing \b for pointfloat because it can end with a decimal point
      // and we don't want to mishandle e.g. `0..hex()`; this should be safe
      // because both MUST contain a decimal point and so cannot be confused with
      // the interior part of an identifier
      {
        begin: `(\\b(${digitpart})|(${pointfloat}))[eE][+-]?(${digitpart})[jJ]?(?=${lookahead})`
      },
      {
        begin: `(${pointfloat})[jJ]?`
      },

      // decinteger, bininteger, octinteger, hexinteger
      // https://docs.python.org/3.9/reference/lexical_analysis.html#integer-literals
      // optionally "long" in Python 2
      // https://docs.python.org/2.7/reference/lexical_analysis.html#integer-and-long-integer-literals
      // decinteger is optionally imaginary
      // https://docs.python.org/3.9/reference/lexical_analysis.html#imaginary-literals
      {
        begin: `\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=${lookahead})`
      },
      {
        begin: `\\b0[bB](_?[01])+[lL]?(?=${lookahead})`
      },
      {
        begin: `\\b0[oO](_?[0-7])+[lL]?(?=${lookahead})`
      },
      {
        begin: `\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=${lookahead})`
      },

      // imagnumber (digitpart-based)
      // https://docs.python.org/3.9/reference/lexical_analysis.html#imaginary-literals
      {
        begin: `\\b(${digitpart})[jJ](?=${lookahead})`
      }
    ]
  };
  const COMMENT_TYPE = {
    className: "comment",
    begin: regex.lookahead(/# type:/),
    end: /$/,
    keywords: KEYWORDS,
    contains: [
      { // prevent keywords from coloring `type`
        begin: /# type:/
      },
      // comment within a datatype comment includes no keywords
      {
        begin: /#/,
        end: /\b\B/,
        endsWithParent: true
      }
    ]
  };
  const PARAMS = {
    className: 'params',
    variants: [
      // Exclude params in functions without params
      {
        className: "",
        begin: /\(\s*\)/,
        skip: true
      },
      {
        begin: /\(/,
        end: /\)/,
        excludeBegin: true,
        excludeEnd: true,
        keywords: KEYWORDS,
        contains: [
          'self',
          PROMPT,
          NUMBER,
          STRING,
          hljs.HASH_COMMENT_MODE
        ]
      }
    ]
  };
  SUBST.contains = [
    STRING,
    NUMBER,
    PROMPT
  ];

  return {
    name: 'Python',
    aliases: [
      'py',
      'gyp',
      'ipython'
    ],
    unicodeRegex: true,
    keywords: KEYWORDS,
    illegal: /(<\/|\?)|=>/,
    contains: [
      PROMPT,
      NUMBER,
      {
        // very common convention
        scope: 'variable.language',
        match: /\bself\b/
      },
      {
        // eat "if" prior to string so that it won't accidentally be
        // labeled as an f-string
        beginKeywords: "if",
        relevance: 0
      },
      { match: /\bor\b/, scope: "keyword" },
      STRING,
      COMMENT_TYPE,
      hljs.HASH_COMMENT_MODE,
      {
        match: [
          /\bdef/, /\s+/,
          IDENT_RE,
        ],
        scope: {
          1: "keyword",
          3: "title.function"
        },
        contains: [ PARAMS ]
      },
      {
        variants: [
          {
            match: [
              /\bclass/, /\s+/,
              IDENT_RE, /\s*/,
              /\(\s*/, IDENT_RE,/\s*\)/
            ],
          },
          {
            match: [
              /\bclass/, /\s+/,
              IDENT_RE
            ],
          }
        ],
        scope: {
          1: "keyword",
          3: "title.class",
          6: "title.class.inherited",
        }
      },
      {
        className: 'meta',
        begin: /^[\t ]*@/,
        end: /(?=#)|$/,
        contains: [
          NUMBER,
          PARAMS,
          STRING
        ]
      }
    ]
  };
}

/*
Language: Rust
Author: Andrey Vlasovskikh <andrey.vlasovskikh@gmail.com>
Contributors: Roman Shmatov <romanshmatov@gmail.com>, Kasper Andersen <kma_untrusted@protonmail.com>
Website: https://www.rust-lang.org
Category: common, system
*/

/** @type LanguageFn */

function rust(hljs) {
  const regex = hljs.regex;
  // ============================================
  // Added to support the r# keyword, which is a raw identifier in Rust.
  const RAW_IDENTIFIER = /(r#)?/;
  const UNDERSCORE_IDENT_RE = regex.concat(RAW_IDENTIFIER, hljs.UNDERSCORE_IDENT_RE);
  const IDENT_RE = regex.concat(RAW_IDENTIFIER, hljs.IDENT_RE);
  // ============================================
  const FUNCTION_INVOKE = {
    className: "title.function.invoke",
    relevance: 0,
    begin: regex.concat(
      /\b/,
      /(?!let|for|while|if|else|match\b)/,
      IDENT_RE,
      regex.lookahead(/\s*\(/))
  };
  const NUMBER_SUFFIX = '([ui](8|16|32|64|128|size)|f(32|64))\?';
  const KEYWORDS = [
    "abstract",
    "as",
    "async",
    "await",
    "become",
    "box",
    "break",
    "const",
    "continue",
    "crate",
    "do",
    "dyn",
    "else",
    "enum",
    "extern",
    "false",
    "final",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "macro",
    "match",
    "mod",
    "move",
    "mut",
    "override",
    "priv",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "try",
    "type",
    "typeof",
    "union",
    "unsafe",
    "unsized",
    "use",
    "virtual",
    "where",
    "while",
    "yield"
  ];
  const LITERALS = [
    "true",
    "false",
    "Some",
    "None",
    "Ok",
    "Err"
  ];
  const BUILTINS = [
    // functions
    'drop ',
    // traits
    "Copy",
    "Send",
    "Sized",
    "Sync",
    "Drop",
    "Fn",
    "FnMut",
    "FnOnce",
    "ToOwned",
    "Clone",
    "Debug",
    "PartialEq",
    "PartialOrd",
    "Eq",
    "Ord",
    "AsRef",
    "AsMut",
    "Into",
    "From",
    "Default",
    "Iterator",
    "Extend",
    "IntoIterator",
    "DoubleEndedIterator",
    "ExactSizeIterator",
    "SliceConcatExt",
    "ToString",
    // macros
    "assert!",
    "assert_eq!",
    "bitflags!",
    "bytes!",
    "cfg!",
    "col!",
    "concat!",
    "concat_idents!",
    "debug_assert!",
    "debug_assert_eq!",
    "env!",
    "eprintln!",
    "panic!",
    "file!",
    "format!",
    "format_args!",
    "include_bytes!",
    "include_str!",
    "line!",
    "local_data_key!",
    "module_path!",
    "option_env!",
    "print!",
    "println!",
    "select!",
    "stringify!",
    "try!",
    "unimplemented!",
    "unreachable!",
    "vec!",
    "write!",
    "writeln!",
    "macro_rules!",
    "assert_ne!",
    "debug_assert_ne!"
  ];
  const TYPES = [
    "i8",
    "i16",
    "i32",
    "i64",
    "i128",
    "isize",
    "u8",
    "u16",
    "u32",
    "u64",
    "u128",
    "usize",
    "f32",
    "f64",
    "str",
    "char",
    "bool",
    "Box",
    "Option",
    "Result",
    "String",
    "Vec"
  ];
  return {
    name: 'Rust',
    aliases: [ 'rs' ],
    keywords: {
      $pattern: hljs.IDENT_RE + '!?',
      type: TYPES,
      keyword: KEYWORDS,
      literal: LITERALS,
      built_in: BUILTINS
    },
    illegal: '</',
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.COMMENT('/\\*', '\\*/', { contains: [ 'self' ] }),
      hljs.inherit(hljs.QUOTE_STRING_MODE, {
        begin: /b?"/,
        illegal: null
      }),
      {
        className: 'symbol',
        // negative lookahead to avoid matching `'`
        begin: /'[a-zA-Z_][a-zA-Z0-9_]*(?!')/
      },
      {
        scope: 'string',
        variants: [
          { begin: /b?r(#*)"(.|\n)*?"\1(?!#)/ },
          {
            begin: /b?'/,
            end: /'/,
            contains: [
              {
                scope: "char.escape",
                match: /\\('|\w|x\w{2}|u\w{4}|U\w{8})/
              }
            ]
          }
        ]
      },
      {
        className: 'number',
        variants: [
          { begin: '\\b0b([01_]+)' + NUMBER_SUFFIX },
          { begin: '\\b0o([0-7_]+)' + NUMBER_SUFFIX },
          { begin: '\\b0x([A-Fa-f0-9_]+)' + NUMBER_SUFFIX },
          { begin: '\\b(\\d[\\d_]*(\\.[0-9_]+)?([eE][+-]?[0-9_]+)?)'
                   + NUMBER_SUFFIX }
        ],
        relevance: 0
      },
      {
        begin: [
          /fn/,
          /\s+/,
          UNDERSCORE_IDENT_RE
        ],
        className: {
          1: "keyword",
          3: "title.function"
        }
      },
      {
        className: 'meta',
        begin: '#!?\\[',
        end: '\\]',
        contains: [
          {
            className: 'string',
            begin: /"/,
            end: /"/,
            contains: [
              hljs.BACKSLASH_ESCAPE
            ]
          }
        ]
      },
      {
        begin: [
          /let/,
          /\s+/,
          /(?:mut\s+)?/,
          UNDERSCORE_IDENT_RE
        ],
        className: {
          1: "keyword",
          3: "keyword",
          4: "variable"
        }
      },
      // must come before impl/for rule later
      {
        begin: [
          /for/,
          /\s+/,
          UNDERSCORE_IDENT_RE,
          /\s+/,
          /in/
        ],
        className: {
          1: "keyword",
          3: "variable",
          5: "keyword"
        }
      },
      {
        begin: [
          /type/,
          /\s+/,
          UNDERSCORE_IDENT_RE
        ],
        className: {
          1: "keyword",
          3: "title.class"
        }
      },
      {
        begin: [
          /(?:trait|enum|struct|union|impl|for)/,
          /\s+/,
          UNDERSCORE_IDENT_RE
        ],
        className: {
          1: "keyword",
          3: "title.class"
        }
      },
      {
        begin: hljs.IDENT_RE + '::',
        keywords: {
          keyword: "Self",
          built_in: BUILTINS,
          type: TYPES
        }
      },
      {
        className: "punctuation",
        begin: '->'
      },
      FUNCTION_INVOKE
    ]
  };
}

/*
Language: Go
Author: Stephan Kountso aka StepLg <steplg@gmail.com>
Contributors: Evgeny Stepanischev <imbolk@gmail.com>
Description: Google go language (golang). For info about language
Website: http://golang.org/
Category: common, system
*/

function go(hljs) {
  const LITERALS = [
    "true",
    "false",
    "iota",
    "nil"
  ];
  const BUILT_INS = [
    "append",
    "cap",
    "close",
    "complex",
    "copy",
    "imag",
    "len",
    "make",
    "new",
    "panic",
    "print",
    "println",
    "real",
    "recover",
    "delete"
  ];
  const TYPES = [
    "bool",
    "byte",
    "complex64",
    "complex128",
    "error",
    "float32",
    "float64",
    "int8",
    "int16",
    "int32",
    "int64",
    "string",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "int",
    "uint",
    "uintptr",
    "rune"
  ];
  const KWS = [
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
  ];
  const KEYWORDS = {
    keyword: KWS,
    type: TYPES,
    literal: LITERALS,
    built_in: BUILT_INS
  };
  return {
    name: 'Go',
    aliases: [ 'golang' ],
    keywords: KEYWORDS,
    illegal: '</',
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: 'string',
        variants: [
          hljs.QUOTE_STRING_MODE,
          hljs.APOS_STRING_MODE,
          {
            begin: '`',
            end: '`'
          }
        ]
      },
      {
        className: 'number',
        variants: [
          {
            match: /-?\b0[xX]\.[a-fA-F0-9](_?[a-fA-F0-9])*[pP][+-]?\d(_?\d)*i?/, // hex without a present digit before . (making a digit afterwards required)
            relevance: 0
          },
          {
            match: /-?\b0[xX](_?[a-fA-F0-9])+((\.([a-fA-F0-9](_?[a-fA-F0-9])*)?)?[pP][+-]?\d(_?\d)*)?i?/, // hex with a present digit before . (making a digit afterwards optional)
            relevance: 0
          },
          {
            match: /-?\b0[oO](_?[0-7])*i?/, // leading 0o octal
            relevance: 0
          },
          {
            match: /-?\.\d(_?\d)*([eE][+-]?\d(_?\d)*)?i?/, // decimal without a present digit before . (making a digit afterwards required)
            relevance: 0
          },
          {
            match: /-?\b\d(_?\d)*(\.(\d(_?\d)*)?)?([eE][+-]?\d(_?\d)*)?i?/, // decimal with a present digit before . (making a digit afterwards optional)
            relevance: 0
          }
        ]
      },
      { begin: /:=/ // relevance booster
      },
      {
        className: 'function',
        beginKeywords: 'func',
        end: '\\s*(\\{|$)',
        excludeEnd: true,
        contains: [
          hljs.TITLE_MODE,
          {
            className: 'params',
            begin: /\(/,
            end: /\)/,
            endsParent: true,
            keywords: KEYWORDS,
            illegal: /["']/
          }
        ]
      }
    ]
  };
}

// https://docs.oracle.com/javase/specs/jls/se15/html/jls-3.html#jls-3.10
var decimalDigits = '[0-9](_*[0-9])*';
var frac = `\\.(${decimalDigits})`;
var hexDigits = '[0-9a-fA-F](_*[0-9a-fA-F])*';
var NUMERIC = {
  className: 'number',
  variants: [
    // DecimalFloatingPointLiteral
    // including ExponentPart
    { begin: `(\\b(${decimalDigits})((${frac})|\\.)?|(${frac}))` +
      `[eE][+-]?(${decimalDigits})[fFdD]?\\b` },
    // excluding ExponentPart
    { begin: `\\b(${decimalDigits})((${frac})[fFdD]?\\b|\\.([fFdD]\\b)?)` },
    { begin: `(${frac})[fFdD]?\\b` },
    { begin: `\\b(${decimalDigits})[fFdD]\\b` },

    // HexadecimalFloatingPointLiteral
    { begin: `\\b0[xX]((${hexDigits})\\.?|(${hexDigits})?\\.(${hexDigits}))` +
      `[pP][+-]?(${decimalDigits})[fFdD]?\\b` },

    // DecimalIntegerLiteral
    { begin: '\\b(0|[1-9](_*[0-9])*)[lL]?\\b' },

    // HexIntegerLiteral
    { begin: `\\b0[xX](${hexDigits})[lL]?\\b` },

    // OctalIntegerLiteral
    { begin: '\\b0(_*[0-7])*[lL]?\\b' },

    // BinaryIntegerLiteral
    { begin: '\\b0[bB][01](_*[01])*[lL]?\\b' },
  ],
  relevance: 0
};

/*
Language: Java
Author: Vsevolod Solovyov <vsevolod.solovyov@gmail.com>
Category: common, enterprise
Website: https://www.java.com/
*/


/**
 * Allows recursive regex expressions to a given depth
 *
 * ie: recurRegex("(abc~~~)", /~~~/g, 2) becomes:
 * (abc(abc(abc)))
 *
 * @param {string} re
 * @param {RegExp} substitution (should be a g mode regex)
 * @param {number} depth
 * @returns {string}``
 */
function recurRegex(re, substitution, depth) {
  if (depth === -1) return "";

  return re.replace(substitution, _ => {
    return recurRegex(re, substitution, depth - 1);
  });
}

/** @type LanguageFn */
function java(hljs) {
  const regex = hljs.regex;
  const JAVA_IDENT_RE = '[\u00C0-\u02B8a-zA-Z_$][\u00C0-\u02B8a-zA-Z_$0-9]*';
  const GENERIC_IDENT_RE = JAVA_IDENT_RE
    + recurRegex('(?:<' + JAVA_IDENT_RE + '~~~(?:\\s*,\\s*' + JAVA_IDENT_RE + '~~~)*>)?', /~~~/g, 2);
  const MAIN_KEYWORDS = [
    'synchronized',
    'abstract',
    'private',
    'var',
    'static',
    'if',
    'const ',
    'for',
    'while',
    'strictfp',
    'finally',
    'protected',
    'import',
    'native',
    'final',
    'void',
    'enum',
    'else',
    'break',
    'transient',
    'catch',
    'instanceof',
    'volatile',
    'case',
    'assert',
    'package',
    'default',
    'public',
    'try',
    'switch',
    'continue',
    'throws',
    'protected',
    'public',
    'private',
    'module',
    'requires',
    'exports',
    'do',
    'sealed',
    'yield',
    'permits',
    'goto',
    'when'
  ];

  const BUILT_INS = [
    'super',
    'this'
  ];

  const LITERALS = [
    'false',
    'true',
    'null'
  ];

  const TYPES = [
    'char',
    'boolean',
    'long',
    'float',
    'int',
    'byte',
    'short',
    'double'
  ];

  const KEYWORDS = {
    keyword: MAIN_KEYWORDS,
    literal: LITERALS,
    type: TYPES,
    built_in: BUILT_INS
  };

  const ANNOTATION = {
    className: 'meta',
    begin: '@' + JAVA_IDENT_RE,
    contains: [
      {
        begin: /\(/,
        end: /\)/,
        contains: [ "self" ] // allow nested () inside our annotation
      }
    ]
  };
  const PARAMS = {
    className: 'params',
    begin: /\(/,
    end: /\)/,
    keywords: KEYWORDS,
    relevance: 0,
    contains: [ hljs.C_BLOCK_COMMENT_MODE ],
    endsParent: true
  };

  return {
    name: 'Java',
    aliases: [ 'jsp' ],
    keywords: KEYWORDS,
    illegal: /<\/|#/,
    contains: [
      hljs.COMMENT(
        '/\\*\\*',
        '\\*/',
        {
          relevance: 0,
          contains: [
            {
              // eat up @'s in emails to prevent them to be recognized as doctags
              begin: /\w+@/,
              relevance: 0
            },
            {
              className: 'doctag',
              begin: '@[A-Za-z]+'
            }
          ]
        }
      ),
      // relevance boost
      {
        begin: /import java\.[a-z]+\./,
        keywords: "import",
        relevance: 2
      },
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        begin: /"""/,
        end: /"""/,
        className: "string",
        contains: [ hljs.BACKSLASH_ESCAPE ]
      },
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      {
        match: [
          /\b(?:class|interface|enum|extends|implements|new)/,
          /\s+/,
          JAVA_IDENT_RE
        ],
        className: {
          1: "keyword",
          3: "title.class"
        }
      },
      {
        // Exceptions for hyphenated keywords
        match: /non-sealed/,
        scope: "keyword"
      },
      {
        begin: [
          regex.concat(/(?!else)/, JAVA_IDENT_RE),
          /\s+/,
          JAVA_IDENT_RE,
          /\s+/,
          /=(?!=)/
        ],
        className: {
          1: "type",
          3: "variable",
          5: "operator"
        }
      },
      {
        begin: [
          /record/,
          /\s+/,
          JAVA_IDENT_RE
        ],
        className: {
          1: "keyword",
          3: "title.class"
        },
        contains: [
          PARAMS,
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE
        ]
      },
      {
        // Expression keywords prevent 'keyword Name(...)' from being
        // recognized as a function definition
        beginKeywords: 'new throw return else',
        relevance: 0
      },
      {
        begin: [
          '(?:' + GENERIC_IDENT_RE + '\\s+)',
          hljs.UNDERSCORE_IDENT_RE,
          /\s*(?=\()/
        ],
        className: { 2: "title.function" },
        keywords: KEYWORDS,
        contains: [
          {
            className: 'params',
            begin: /\(/,
            end: /\)/,
            keywords: KEYWORDS,
            relevance: 0,
            contains: [
              ANNOTATION,
              hljs.APOS_STRING_MODE,
              hljs.QUOTE_STRING_MODE,
              NUMERIC,
              hljs.C_BLOCK_COMMENT_MODE
            ]
          },
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE
        ]
      },
      NUMERIC,
      ANNOTATION
    ]
  };
}

/*
Language: C++
Category: common, system
Website: https://isocpp.org
*/

/** @type LanguageFn */
function cpp(hljs) {
  const regex = hljs.regex;
  // added for historic reasons because `hljs.C_LINE_COMMENT_MODE` does
  // not include such support nor can we be sure all the grammars depending
  // on it would desire this behavior
  const C_LINE_COMMENT_MODE = hljs.COMMENT('//', '$', { contains: [ { begin: /\\\n/ } ] });
  const DECLTYPE_AUTO_RE = 'decltype\\(auto\\)';
  const NAMESPACE_RE = '[a-zA-Z_]\\w*::';
  const TEMPLATE_ARGUMENT_RE = '<[^<>]+>';
  const FUNCTION_TYPE_RE = '(?!struct)('
    + DECLTYPE_AUTO_RE + '|'
    + regex.optional(NAMESPACE_RE)
    + '[a-zA-Z_]\\w*' + regex.optional(TEMPLATE_ARGUMENT_RE)
  + ')';

  const CPP_PRIMITIVE_TYPES = {
    className: 'type',
    begin: '\\b[a-z\\d_]*_t\\b'
  };

  // https://en.cppreference.com/w/cpp/language/escape
  // \\ \x \xFF \u2837 \u00323747 \374
  const CHARACTER_ESCAPES = '\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)';
  const STRINGS = {
    className: 'string',
    variants: [
      {
        begin: '(u8?|U|L)?"',
        end: '"',
        illegal: '\\n',
        contains: [ hljs.BACKSLASH_ESCAPE ]
      },
      {
        begin: '(u8?|U|L)?\'(' + CHARACTER_ESCAPES + '|.)',
        end: '\'',
        illegal: '.'
      },
      hljs.END_SAME_AS_BEGIN({
        begin: /(?:u8?|U|L)?R"([^()\\ ]{0,16})\(/,
        end: /\)([^()\\ ]{0,16})"/
      })
    ]
  };

  const NUMBERS = {
    className: 'number',
    variants: [
      // Floating-point literal.
      { begin:
        "[+-]?(?:" // Leading sign.
          // Decimal.
          + "(?:"
            +"[0-9](?:'?[0-9])*\\.(?:[0-9](?:'?[0-9])*)?"
            + "|\\.[0-9](?:'?[0-9])*"
          + ")(?:[Ee][+-]?[0-9](?:'?[0-9])*)?"
          + "|[0-9](?:'?[0-9])*[Ee][+-]?[0-9](?:'?[0-9])*"
          // Hexadecimal.
          + "|0[Xx](?:"
            +"[0-9A-Fa-f](?:'?[0-9A-Fa-f])*(?:\\.(?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)?)?"
            + "|\\.[0-9A-Fa-f](?:'?[0-9A-Fa-f])*"
          + ")[Pp][+-]?[0-9](?:'?[0-9])*"
        + ")(?:" // Literal suffixes.
          + "[Ff](?:16|32|64|128)?"
          + "|(BF|bf)16"
          + "|[Ll]"
          + "|" // Literal suffix is optional.
        + ")"
      },
      // Integer literal.
      { begin:
        "[+-]?\\b(?:" // Leading sign.
          + "0[Bb][01](?:'?[01])*" // Binary.
          + "|0[Xx][0-9A-Fa-f](?:'?[0-9A-Fa-f])*" // Hexadecimal.
          + "|0(?:'?[0-7])*" // Octal or just a lone zero.
          + "|[1-9](?:'?[0-9])*" // Decimal.
        + ")(?:" // Literal suffixes.
          + "[Uu](?:LL?|ll?)"
          + "|[Uu][Zz]?"
          + "|(?:LL?|ll?)[Uu]?"
          + "|[Zz][Uu]"
          + "|" // Literal suffix is optional.
        + ")"
        // Note: there are user-defined literal suffixes too, but perhaps having the custom suffix not part of the
        // literal highlight actually makes it stand out more.
      }
    ],
    relevance: 0
  };

  const PREPROCESSOR = {
    className: 'meta',
    begin: /#\s*[a-z]+\b/,
    end: /$/,
    keywords: { keyword:
        'if else elif endif define undef warning error line '
        + 'pragma _Pragma ifdef ifndef include' },
    contains: [
      {
        begin: /\\\n/,
        relevance: 0
      },
      hljs.inherit(STRINGS, { className: 'string' }),
      {
        className: 'string',
        begin: /<.*?>/
      },
      C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE
    ]
  };

  const TITLE_MODE = {
    className: 'title',
    begin: regex.optional(NAMESPACE_RE) + hljs.IDENT_RE,
    relevance: 0
  };

  const FUNCTION_TITLE = regex.optional(NAMESPACE_RE) + hljs.IDENT_RE + '\\s*\\(';

  // https://en.cppreference.com/w/cpp/keyword
  const RESERVED_KEYWORDS = [
    'alignas',
    'alignof',
    'and',
    'and_eq',
    'asm',
    'atomic_cancel',
    'atomic_commit',
    'atomic_noexcept',
    'auto',
    'bitand',
    'bitor',
    'break',
    'case',
    'catch',
    'class',
    'co_await',
    'co_return',
    'co_yield',
    'compl',
    'concept',
    'const_cast|10',
    'consteval',
    'constexpr',
    'constinit',
    'continue',
    'decltype',
    'default',
    'delete',
    'do',
    'dynamic_cast|10',
    'else',
    'enum',
    'explicit',
    'export',
    'extern',
    'false',
    'final',
    'for',
    'friend',
    'goto',
    'if',
    'import',
    'inline',
    'module',
    'mutable',
    'namespace',
    'new',
    'noexcept',
    'not',
    'not_eq',
    'nullptr',
    'operator',
    'or',
    'or_eq',
    'override',
    'private',
    'protected',
    'public',
    'reflexpr',
    'register',
    'reinterpret_cast|10',
    'requires',
    'return',
    'sizeof',
    'static_assert',
    'static_cast|10',
    'struct',
    'switch',
    'synchronized',
    'template',
    'this',
    'thread_local',
    'throw',
    'transaction_safe',
    'transaction_safe_dynamic',
    'true',
    'try',
    'typedef',
    'typeid',
    'typename',
    'union',
    'using',
    'virtual',
    'volatile',
    'while',
    'xor',
    'xor_eq'
  ];

  // https://en.cppreference.com/w/cpp/keyword
  const RESERVED_TYPES = [
    'bool',
    'char',
    'char16_t',
    'char32_t',
    'char8_t',
    'double',
    'float',
    'int',
    'long',
    'short',
    'void',
    'wchar_t',
    'unsigned',
    'signed',
    'const',
    'static'
  ];

  const TYPE_HINTS = [
    'any',
    'auto_ptr',
    'barrier',
    'binary_semaphore',
    'bitset',
    'complex',
    'condition_variable',
    'condition_variable_any',
    'counting_semaphore',
    'deque',
    'false_type',
    'flat_map',
    'flat_set',
    'future',
    'imaginary',
    'initializer_list',
    'istringstream',
    'jthread',
    'latch',
    'lock_guard',
    'multimap',
    'multiset',
    'mutex',
    'optional',
    'ostringstream',
    'packaged_task',
    'pair',
    'promise',
    'priority_queue',
    'queue',
    'recursive_mutex',
    'recursive_timed_mutex',
    'scoped_lock',
    'set',
    'shared_future',
    'shared_lock',
    'shared_mutex',
    'shared_timed_mutex',
    'shared_ptr',
    'stack',
    'string_view',
    'stringstream',
    'timed_mutex',
    'thread',
    'true_type',
    'tuple',
    'unique_lock',
    'unique_ptr',
    'unordered_map',
    'unordered_multimap',
    'unordered_multiset',
    'unordered_set',
    'variant',
    'vector',
    'weak_ptr',
    'wstring',
    'wstring_view'
  ];

  const FUNCTION_HINTS = [
    'abort',
    'abs',
    'acos',
    'apply',
    'as_const',
    'asin',
    'atan',
    'atan2',
    'calloc',
    'ceil',
    'cerr',
    'cin',
    'clog',
    'cos',
    'cosh',
    'cout',
    'declval',
    'endl',
    'exchange',
    'exit',
    'exp',
    'fabs',
    'floor',
    'fmod',
    'forward',
    'fprintf',
    'fputs',
    'free',
    'frexp',
    'fscanf',
    'future',
    'invoke',
    'isalnum',
    'isalpha',
    'iscntrl',
    'isdigit',
    'isgraph',
    'islower',
    'isprint',
    'ispunct',
    'isspace',
    'isupper',
    'isxdigit',
    'labs',
    'launder',
    'ldexp',
    'log',
    'log10',
    'make_pair',
    'make_shared',
    'make_shared_for_overwrite',
    'make_tuple',
    'make_unique',
    'malloc',
    'memchr',
    'memcmp',
    'memcpy',
    'memset',
    'modf',
    'move',
    'pow',
    'printf',
    'putchar',
    'puts',
    'realloc',
    'scanf',
    'sin',
    'sinh',
    'snprintf',
    'sprintf',
    'sqrt',
    'sscanf',
    'std',
    'stderr',
    'stdin',
    'stdout',
    'strcat',
    'strchr',
    'strcmp',
    'strcpy',
    'strcspn',
    'strlen',
    'strncat',
    'strncmp',
    'strncpy',
    'strpbrk',
    'strrchr',
    'strspn',
    'strstr',
    'swap',
    'tan',
    'tanh',
    'terminate',
    'to_underlying',
    'tolower',
    'toupper',
    'vfprintf',
    'visit',
    'vprintf',
    'vsprintf'
  ];

  const LITERALS = [
    'NULL',
    'false',
    'nullopt',
    'nullptr',
    'true'
  ];

  // https://en.cppreference.com/w/cpp/keyword
  const BUILT_IN = [ '_Pragma' ];

  const CPP_KEYWORDS = {
    type: RESERVED_TYPES,
    keyword: RESERVED_KEYWORDS,
    literal: LITERALS,
    built_in: BUILT_IN,
    _type_hints: TYPE_HINTS
  };

  const FUNCTION_DISPATCH = {
    className: 'function.dispatch',
    relevance: 0,
    keywords: {
      // Only for relevance, not highlighting.
      _hint: FUNCTION_HINTS },
    begin: regex.concat(
      /\b/,
      /(?!decltype)/,
      /(?!if)/,
      /(?!for)/,
      /(?!switch)/,
      /(?!while)/,
      hljs.IDENT_RE,
      regex.lookahead(/(<[^<>]+>|)\s*\(/))
  };

  const EXPRESSION_CONTAINS = [
    FUNCTION_DISPATCH,
    PREPROCESSOR,
    CPP_PRIMITIVE_TYPES,
    C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    NUMBERS,
    STRINGS
  ];

  const EXPRESSION_CONTEXT = {
    // This mode covers expression context where we can't expect a function
    // definition and shouldn't highlight anything that looks like one:
    // `return some()`, `else if()`, `(x*sum(1, 2))`
    variants: [
      {
        begin: /=/,
        end: /;/
      },
      {
        begin: /\(/,
        end: /\)/
      },
      {
        beginKeywords: 'new throw return else',
        end: /;/
      }
    ],
    keywords: CPP_KEYWORDS,
    contains: EXPRESSION_CONTAINS.concat([
      {
        begin: /\(/,
        end: /\)/,
        keywords: CPP_KEYWORDS,
        contains: EXPRESSION_CONTAINS.concat([ 'self' ]),
        relevance: 0
      }
    ]),
    relevance: 0
  };

  const FUNCTION_DECLARATION = {
    className: 'function',
    begin: '(' + FUNCTION_TYPE_RE + '[\\*&\\s]+)+' + FUNCTION_TITLE,
    returnBegin: true,
    end: /[{;=]/,
    excludeEnd: true,
    keywords: CPP_KEYWORDS,
    illegal: /[^\w\s\*&:<>.]/,
    contains: [
      { // to prevent it from being confused as the function title
        begin: DECLTYPE_AUTO_RE,
        keywords: CPP_KEYWORDS,
        relevance: 0
      },
      {
        begin: FUNCTION_TITLE,
        returnBegin: true,
        contains: [ TITLE_MODE ],
        relevance: 0
      },
      // needed because we do not have look-behind on the below rule
      // to prevent it from grabbing the final : in a :: pair
      {
        begin: /::/,
        relevance: 0
      },
      // initializers
      {
        begin: /:/,
        endsWithParent: true,
        contains: [
          STRINGS,
          NUMBERS
        ]
      },
      // allow for multiple declarations, e.g.:
      // extern void f(int), g(char);
      {
        relevance: 0,
        match: /,/
      },
      {
        className: 'params',
        begin: /\(/,
        end: /\)/,
        keywords: CPP_KEYWORDS,
        relevance: 0,
        contains: [
          C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          STRINGS,
          NUMBERS,
          CPP_PRIMITIVE_TYPES,
          // Count matching parentheses.
          {
            begin: /\(/,
            end: /\)/,
            keywords: CPP_KEYWORDS,
            relevance: 0,
            contains: [
              'self',
              C_LINE_COMMENT_MODE,
              hljs.C_BLOCK_COMMENT_MODE,
              STRINGS,
              NUMBERS,
              CPP_PRIMITIVE_TYPES
            ]
          }
        ]
      },
      CPP_PRIMITIVE_TYPES,
      C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      PREPROCESSOR
    ]
  };

  return {
    name: 'C++',
    aliases: [
      'cc',
      'c++',
      'h++',
      'hpp',
      'hh',
      'hxx',
      'cxx'
    ],
    keywords: CPP_KEYWORDS,
    illegal: '</',
    classNameAliases: { 'function.dispatch': 'built_in' },
    contains: [].concat(
      EXPRESSION_CONTEXT,
      FUNCTION_DECLARATION,
      FUNCTION_DISPATCH,
      EXPRESSION_CONTAINS,
      [
        PREPROCESSOR,
        { // containers: ie, `vector <int> rooms (9);`
          begin: '\\b(deque|list|queue|priority_queue|pair|stack|vector|map|set|bitset|multiset|multimap|unordered_map|unordered_set|unordered_multiset|unordered_multimap|array|tuple|optional|variant|function|flat_map|flat_set)\\s*<(?!<)',
          end: '>',
          keywords: CPP_KEYWORDS,
          contains: [
            'self',
            CPP_PRIMITIVE_TYPES
          ]
        },
        {
          begin: hljs.IDENT_RE + '::',
          keywords: CPP_KEYWORDS
        },
        {
          match: [
            // extra complexity to deal with `enum class` and `enum struct`
            /\b(?:enum(?:\s+(?:class|struct))?|class|struct|union)/,
            /\s+/,
            /\w+/
          ],
          className: {
            1: 'keyword',
            3: 'title.class'
          }
        }
      ])
  };
}

const MODES = (hljs) => {
  return {
    IMPORTANT: {
      scope: 'meta',
      begin: '!important'
    },
    BLOCK_COMMENT: hljs.C_BLOCK_COMMENT_MODE,
    HEXCOLOR: {
      scope: 'number',
      begin: /#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/
    },
    FUNCTION_DISPATCH: {
      className: "built_in",
      begin: /[\w-]+(?=\()/
    },
    ATTRIBUTE_SELECTOR_MODE: {
      scope: 'selector-attr',
      begin: /\[/,
      end: /\]/,
      illegal: '$',
      contains: [
        hljs.APOS_STRING_MODE,
        hljs.QUOTE_STRING_MODE
      ]
    },
    CSS_NUMBER_MODE: {
      scope: 'number',
      begin: hljs.NUMBER_RE + '(' +
        '%|em|ex|ch|rem' +
        '|vw|vh|vmin|vmax' +
        '|cm|mm|in|pt|pc|px' +
        '|deg|grad|rad|turn' +
        '|s|ms' +
        '|Hz|kHz' +
        '|dpi|dpcm|dppx' +
        ')?',
      relevance: 0
    },
    CSS_VARIABLE: {
      className: "attr",
      begin: /--[A-Za-z_][A-Za-z0-9_-]*/
    }
  };
};

const HTML_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'audio',
  'b',
  'blockquote',
  'body',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'menu',
  'nav',
  'object',
  'ol',
  'optgroup',
  'option',
  'p',
  'picture',
  'q',
  'quote',
  'samp',
  'section',
  'select',
  'source',
  'span',
  'strong',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
  'var',
  'video'
];

const SVG_TAGS = [
  'defs',
  'g',
  'marker',
  'mask',
  'pattern',
  'svg',
  'switch',
  'symbol',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feFlood',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMorphology',
  'feOffset',
  'feSpecularLighting',
  'feTile',
  'feTurbulence',
  'linearGradient',
  'radialGradient',
  'stop',
  'circle',
  'ellipse',
  'image',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'text',
  'use',
  'textPath',
  'tspan',
  'foreignObject',
  'clipPath'
];

const TAGS = [
  ...HTML_TAGS,
  ...SVG_TAGS,
];

// Sorting, then reversing makes sure longer attributes/elements like
// `font-weight` are matched fully instead of getting false positives on say `font`

const MEDIA_FEATURES = [
  'any-hover',
  'any-pointer',
  'aspect-ratio',
  'color',
  'color-gamut',
  'color-index',
  'device-aspect-ratio',
  'device-height',
  'device-width',
  'display-mode',
  'forced-colors',
  'grid',
  'height',
  'hover',
  'inverted-colors',
  'monochrome',
  'orientation',
  'overflow-block',
  'overflow-inline',
  'pointer',
  'prefers-color-scheme',
  'prefers-contrast',
  'prefers-reduced-motion',
  'prefers-reduced-transparency',
  'resolution',
  'scan',
  'scripting',
  'update',
  'width',
  // TODO: find a better solution?
  'min-width',
  'max-width',
  'min-height',
  'max-height'
].sort().reverse();

// https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-classes
const PSEUDO_CLASSES = [
  'active',
  'any-link',
  'blank',
  'checked',
  'current',
  'default',
  'defined',
  'dir', // dir()
  'disabled',
  'drop',
  'empty',
  'enabled',
  'first',
  'first-child',
  'first-of-type',
  'fullscreen',
  'future',
  'focus',
  'focus-visible',
  'focus-within',
  'has', // has()
  'host', // host or host()
  'host-context', // host-context()
  'hover',
  'indeterminate',
  'in-range',
  'invalid',
  'is', // is()
  'lang', // lang()
  'last-child',
  'last-of-type',
  'left',
  'link',
  'local-link',
  'not', // not()
  'nth-child', // nth-child()
  'nth-col', // nth-col()
  'nth-last-child', // nth-last-child()
  'nth-last-col', // nth-last-col()
  'nth-last-of-type', //nth-last-of-type()
  'nth-of-type', //nth-of-type()
  'only-child',
  'only-of-type',
  'optional',
  'out-of-range',
  'past',
  'placeholder-shown',
  'read-only',
  'read-write',
  'required',
  'right',
  'root',
  'scope',
  'target',
  'target-within',
  'user-invalid',
  'valid',
  'visited',
  'where' // where()
].sort().reverse();

// https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-elements
const PSEUDO_ELEMENTS = [
  'after',
  'backdrop',
  'before',
  'cue',
  'cue-region',
  'first-letter',
  'first-line',
  'grammar-error',
  'marker',
  'part',
  'placeholder',
  'selection',
  'slotted',
  'spelling-error'
].sort().reverse();

const ATTRIBUTES = [
  'accent-color',
  'align-content',
  'align-items',
  'align-self',
  'alignment-baseline',
  'all',
  'anchor-name',
  'animation',
  'animation-composition',
  'animation-delay',
  'animation-direction',
  'animation-duration',
  'animation-fill-mode',
  'animation-iteration-count',
  'animation-name',
  'animation-play-state',
  'animation-range',
  'animation-range-end',
  'animation-range-start',
  'animation-timeline',
  'animation-timing-function',
  'appearance',
  'aspect-ratio',
  'backdrop-filter',
  'backface-visibility',
  'background',
  'background-attachment',
  'background-blend-mode',
  'background-clip',
  'background-color',
  'background-image',
  'background-origin',
  'background-position',
  'background-position-x',
  'background-position-y',
  'background-repeat',
  'background-size',
  'baseline-shift',
  'block-size',
  'border',
  'border-block',
  'border-block-color',
  'border-block-end',
  'border-block-end-color',
  'border-block-end-style',
  'border-block-end-width',
  'border-block-start',
  'border-block-start-color',
  'border-block-start-style',
  'border-block-start-width',
  'border-block-style',
  'border-block-width',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-end-end-radius',
  'border-end-start-radius',
  'border-image',
  'border-image-outset',
  'border-image-repeat',
  'border-image-slice',
  'border-image-source',
  'border-image-width',
  'border-inline',
  'border-inline-color',
  'border-inline-end',
  'border-inline-end-color',
  'border-inline-end-style',
  'border-inline-end-width',
  'border-inline-start',
  'border-inline-start-color',
  'border-inline-start-style',
  'border-inline-start-width',
  'border-inline-style',
  'border-inline-width',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-spacing',
  'border-start-end-radius',
  'border-start-start-radius',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'bottom',
  'box-align',
  'box-decoration-break',
  'box-direction',
  'box-flex',
  'box-flex-group',
  'box-lines',
  'box-ordinal-group',
  'box-orient',
  'box-pack',
  'box-shadow',
  'box-sizing',
  'break-after',
  'break-before',
  'break-inside',
  'caption-side',
  'caret-color',
  'clear',
  'clip',
  'clip-path',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-profile',
  'color-rendering',
  'color-scheme',
  'column-count',
  'column-fill',
  'column-gap',
  'column-rule',
  'column-rule-color',
  'column-rule-style',
  'column-rule-width',
  'column-span',
  'column-width',
  'columns',
  'contain',
  'contain-intrinsic-block-size',
  'contain-intrinsic-height',
  'contain-intrinsic-inline-size',
  'contain-intrinsic-size',
  'contain-intrinsic-width',
  'container',
  'container-name',
  'container-type',
  'content',
  'content-visibility',
  'counter-increment',
  'counter-reset',
  'counter-set',
  'cue',
  'cue-after',
  'cue-before',
  'cursor',
  'cx',
  'cy',
  'direction',
  'display',
  'dominant-baseline',
  'empty-cells',
  'enable-background',
  'field-sizing',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'float',
  'flood-color',
  'flood-opacity',
  'flow',
  'font',
  'font-display',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-language-override',
  'font-optical-sizing',
  'font-palette',
  'font-size',
  'font-size-adjust',
  'font-smooth',
  'font-smoothing',
  'font-stretch',
  'font-style',
  'font-synthesis',
  'font-synthesis-position',
  'font-synthesis-small-caps',
  'font-synthesis-style',
  'font-synthesis-weight',
  'font-variant',
  'font-variant-alternates',
  'font-variant-caps',
  'font-variant-east-asian',
  'font-variant-emoji',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-variant-position',
  'font-variation-settings',
  'font-weight',
  'forced-color-adjust',
  'gap',
  'glyph-orientation-horizontal',
  'glyph-orientation-vertical',
  'grid',
  'grid-area',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-gap',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'grid-template',
  'grid-template-areas',
  'grid-template-columns',
  'grid-template-rows',
  'hanging-punctuation',
  'height',
  'hyphenate-character',
  'hyphenate-limit-chars',
  'hyphens',
  'icon',
  'image-orientation',
  'image-rendering',
  'image-resolution',
  'ime-mode',
  'initial-letter',
  'initial-letter-align',
  'inline-size',
  'inset',
  'inset-area',
  'inset-block',
  'inset-block-end',
  'inset-block-start',
  'inset-inline',
  'inset-inline-end',
  'inset-inline-start',
  'isolation',
  'justify-content',
  'justify-items',
  'justify-self',
  'kerning',
  'left',
  'letter-spacing',
  'lighting-color',
  'line-break',
  'line-height',
  'line-height-step',
  'list-style',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'margin',
  'margin-block',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-inline',
  'margin-inline-end',
  'margin-inline-start',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-trim',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'marks',
  'mask',
  'mask-border',
  'mask-border-mode',
  'mask-border-outset',
  'mask-border-repeat',
  'mask-border-slice',
  'mask-border-source',
  'mask-border-width',
  'mask-clip',
  'mask-composite',
  'mask-image',
  'mask-mode',
  'mask-origin',
  'mask-position',
  'mask-repeat',
  'mask-size',
  'mask-type',
  'masonry-auto-flow',
  'math-depth',
  'math-shift',
  'math-style',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'mix-blend-mode',
  'nav-down',
  'nav-index',
  'nav-left',
  'nav-right',
  'nav-up',
  'none',
  'normal',
  'object-fit',
  'object-position',
  'offset',
  'offset-anchor',
  'offset-distance',
  'offset-path',
  'offset-position',
  'offset-rotate',
  'opacity',
  'order',
  'orphans',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-anchor',
  'overflow-block',
  'overflow-clip-margin',
  'overflow-inline',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'overlay',
  'overscroll-behavior',
  'overscroll-behavior-block',
  'overscroll-behavior-inline',
  'overscroll-behavior-x',
  'overscroll-behavior-y',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-inline',
  'padding-inline-end',
  'padding-inline-start',
  'padding-left',
  'padding-right',
  'padding-top',
  'page',
  'page-break-after',
  'page-break-before',
  'page-break-inside',
  'paint-order',
  'pause',
  'pause-after',
  'pause-before',
  'perspective',
  'perspective-origin',
  'place-content',
  'place-items',
  'place-self',
  'pointer-events',
  'position',
  'position-anchor',
  'position-visibility',
  'print-color-adjust',
  'quotes',
  'r',
  'resize',
  'rest',
  'rest-after',
  'rest-before',
  'right',
  'rotate',
  'row-gap',
  'ruby-align',
  'ruby-position',
  'scale',
  'scroll-behavior',
  'scroll-margin',
  'scroll-margin-block',
  'scroll-margin-block-end',
  'scroll-margin-block-start',
  'scroll-margin-bottom',
  'scroll-margin-inline',
  'scroll-margin-inline-end',
  'scroll-margin-inline-start',
  'scroll-margin-left',
  'scroll-margin-right',
  'scroll-margin-top',
  'scroll-padding',
  'scroll-padding-block',
  'scroll-padding-block-end',
  'scroll-padding-block-start',
  'scroll-padding-bottom',
  'scroll-padding-inline',
  'scroll-padding-inline-end',
  'scroll-padding-inline-start',
  'scroll-padding-left',
  'scroll-padding-right',
  'scroll-padding-top',
  'scroll-snap-align',
  'scroll-snap-stop',
  'scroll-snap-type',
  'scroll-timeline',
  'scroll-timeline-axis',
  'scroll-timeline-name',
  'scrollbar-color',
  'scrollbar-gutter',
  'scrollbar-width',
  'shape-image-threshold',
  'shape-margin',
  'shape-outside',
  'shape-rendering',
  'speak',
  'speak-as',
  'src', // @font-face
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'tab-size',
  'table-layout',
  'text-align',
  'text-align-all',
  'text-align-last',
  'text-anchor',
  'text-combine-upright',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-skip',
  'text-decoration-skip-ink',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-emphasis',
  'text-emphasis-color',
  'text-emphasis-position',
  'text-emphasis-style',
  'text-indent',
  'text-justify',
  'text-orientation',
  'text-overflow',
  'text-rendering',
  'text-shadow',
  'text-size-adjust',
  'text-transform',
  'text-underline-offset',
  'text-underline-position',
  'text-wrap',
  'text-wrap-mode',
  'text-wrap-style',
  'timeline-scope',
  'top',
  'touch-action',
  'transform',
  'transform-box',
  'transform-origin',
  'transform-style',
  'transition',
  'transition-behavior',
  'transition-delay',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'translate',
  'unicode-bidi',
  'user-modify',
  'user-select',
  'vector-effect',
  'vertical-align',
  'view-timeline',
  'view-timeline-axis',
  'view-timeline-inset',
  'view-timeline-name',
  'view-transition-name',
  'visibility',
  'voice-balance',
  'voice-duration',
  'voice-family',
  'voice-pitch',
  'voice-range',
  'voice-rate',
  'voice-stress',
  'voice-volume',
  'white-space',
  'white-space-collapse',
  'widows',
  'width',
  'will-change',
  'word-break',
  'word-spacing',
  'word-wrap',
  'writing-mode',
  'x',
  'y',
  'z-index',
  'zoom'
].sort().reverse();

/*
Language: CSS
Category: common, css, web
Website: https://developer.mozilla.org/en-US/docs/Web/CSS
*/


/** @type LanguageFn */
function css(hljs) {
  const regex = hljs.regex;
  const modes = MODES(hljs);
  const VENDOR_PREFIX = { begin: /-(webkit|moz|ms|o)-(?=[a-z])/ };
  const AT_MODIFIERS = "and or not only";
  const AT_PROPERTY_RE = /@-?\w[\w]*(-\w+)*/; // @-webkit-keyframes
  const IDENT_RE = '[a-zA-Z-][a-zA-Z0-9_-]*';
  const STRINGS = [
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE
  ];

  return {
    name: 'CSS',
    case_insensitive: true,
    illegal: /[=|'\$]/,
    keywords: { keyframePosition: "from to" },
    classNameAliases: {
      // for visual continuity with `tag {}` and because we
      // don't have a great class for this?
      keyframePosition: "selector-tag" },
    contains: [
      modes.BLOCK_COMMENT,
      VENDOR_PREFIX,
      // to recognize keyframe 40% etc which are outside the scope of our
      // attribute value mode
      modes.CSS_NUMBER_MODE,
      {
        className: 'selector-id',
        begin: /#[A-Za-z0-9_-]+/,
        relevance: 0
      },
      {
        className: 'selector-class',
        begin: '\\.' + IDENT_RE,
        relevance: 0
      },
      modes.ATTRIBUTE_SELECTOR_MODE,
      {
        className: 'selector-pseudo',
        variants: [
          { begin: ':(' + PSEUDO_CLASSES.join('|') + ')' },
          { begin: ':(:)?(' + PSEUDO_ELEMENTS.join('|') + ')' }
        ]
      },
      // we may actually need this (12/2020)
      // { // pseudo-selector params
      //   begin: /\(/,
      //   end: /\)/,
      //   contains: [ hljs.CSS_NUMBER_MODE ]
      // },
      modes.CSS_VARIABLE,
      {
        className: 'attribute',
        begin: '\\b(' + ATTRIBUTES.join('|') + ')\\b'
      },
      // attribute values
      {
        begin: /:/,
        end: /[;}{]/,
        contains: [
          modes.BLOCK_COMMENT,
          modes.HEXCOLOR,
          modes.IMPORTANT,
          modes.CSS_NUMBER_MODE,
          ...STRINGS,
          // needed to highlight these as strings and to avoid issues with
          // illegal characters that might be inside urls that would tigger the
          // languages illegal stack
          {
            begin: /(url|data-uri)\(/,
            end: /\)/,
            relevance: 0, // from keywords
            keywords: { built_in: "url data-uri" },
            contains: [
              ...STRINGS,
              {
                className: "string",
                // any character other than `)` as in `url()` will be the start
                // of a string, which ends with `)` (from the parent mode)
                begin: /[^)]/,
                endsWithParent: true,
                excludeEnd: true
              }
            ]
          },
          modes.FUNCTION_DISPATCH
        ]
      },
      {
        begin: regex.lookahead(/@/),
        end: '[{;]',
        relevance: 0,
        illegal: /:/, // break on Less variables @var: ...
        contains: [
          {
            className: 'keyword',
            begin: AT_PROPERTY_RE
          },
          {
            begin: /\s/,
            endsWithParent: true,
            excludeEnd: true,
            relevance: 0,
            keywords: {
              $pattern: /[a-z-]+/,
              keyword: AT_MODIFIERS,
              attribute: MEDIA_FEATURES.join(" ")
            },
            contains: [
              {
                begin: /[a-z-]+(?=:)/,
                className: "attribute"
              },
              ...STRINGS,
              modes.CSS_NUMBER_MODE
            ]
          }
        ]
      },
      {
        className: 'selector-tag',
        begin: '\\b(' + TAGS.join('|') + ')\\b'
      }
    ]
  };
}

/*
Language: HTML, XML
Website: https://www.w3.org/XML/
Category: common, web
Audit: 2020
*/

/** @type LanguageFn */
function xml(hljs) {
  const regex = hljs.regex;
  // XML names can have the following additional letters: https://www.w3.org/TR/xml/#NT-NameChar
  // OTHER_NAME_CHARS = /[:\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]/;
  // Element names start with NAME_START_CHAR followed by optional other Unicode letters, ASCII digits, hyphens, underscores, and periods
  // const TAG_NAME_RE = regex.concat(/[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/, regex.optional(/[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*:/), /[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*/);;
  // const XML_IDENT_RE = /[A-Z_a-z:\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]+/;
  // const TAG_NAME_RE = regex.concat(/[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/, regex.optional(/[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*:/), /[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*/);
  // however, to cater for performance and more Unicode support rely simply on the Unicode letter class
  const TAG_NAME_RE = regex.concat(/[\p{L}_]/u, regex.optional(/[\p{L}0-9_.-]*:/u), /[\p{L}0-9_.-]*/u);
  const XML_IDENT_RE = /[\p{L}0-9._:-]+/u;
  const XML_ENTITIES = {
    className: 'symbol',
    begin: /&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/
  };
  const XML_META_KEYWORDS = {
    begin: /\s/,
    contains: [
      {
        className: 'keyword',
        begin: /#?[a-z_][a-z1-9_-]+/,
        illegal: /\n/
      }
    ]
  };
  const XML_META_PAR_KEYWORDS = hljs.inherit(XML_META_KEYWORDS, {
    begin: /\(/,
    end: /\)/
  });
  const APOS_META_STRING_MODE = hljs.inherit(hljs.APOS_STRING_MODE, { className: 'string' });
  const QUOTE_META_STRING_MODE = hljs.inherit(hljs.QUOTE_STRING_MODE, { className: 'string' });
  const TAG_INTERNALS = {
    endsWithParent: true,
    illegal: /</,
    relevance: 0,
    contains: [
      {
        className: 'attr',
        begin: XML_IDENT_RE,
        relevance: 0
      },
      {
        begin: /=\s*/,
        relevance: 0,
        contains: [
          {
            className: 'string',
            endsParent: true,
            variants: [
              {
                begin: /"/,
                end: /"/,
                contains: [ XML_ENTITIES ]
              },
              {
                begin: /'/,
                end: /'/,
                contains: [ XML_ENTITIES ]
              },
              { begin: /[^\s"'=<>`]+/ }
            ]
          }
        ]
      }
    ]
  };
  return {
    name: 'HTML, XML',
    aliases: [
      'html',
      'xhtml',
      'rss',
      'atom',
      'xjb',
      'xsd',
      'xsl',
      'plist',
      'wsf',
      'svg'
    ],
    case_insensitive: true,
    unicodeRegex: true,
    contains: [
      {
        className: 'meta',
        begin: /<![a-z]/,
        end: />/,
        relevance: 10,
        contains: [
          XML_META_KEYWORDS,
          QUOTE_META_STRING_MODE,
          APOS_META_STRING_MODE,
          XML_META_PAR_KEYWORDS,
          {
            begin: /\[/,
            end: /\]/,
            contains: [
              {
                className: 'meta',
                begin: /<![a-z]/,
                end: />/,
                contains: [
                  XML_META_KEYWORDS,
                  XML_META_PAR_KEYWORDS,
                  QUOTE_META_STRING_MODE,
                  APOS_META_STRING_MODE
                ]
              }
            ]
          }
        ]
      },
      hljs.COMMENT(
        /<!--/,
        /-->/,
        { relevance: 10 }
      ),
      {
        begin: /<!\[CDATA\[/,
        end: /\]\]>/,
        relevance: 10
      },
      XML_ENTITIES,
      // xml processing instructions
      {
        className: 'meta',
        end: /\?>/,
        variants: [
          {
            begin: /<\?xml/,
            relevance: 10,
            contains: [
              QUOTE_META_STRING_MODE
            ]
          },
          {
            begin: /<\?[a-z][a-z0-9]+/,
          }
        ]

      },
      {
        className: 'tag',
        /*
        The lookahead pattern (?=...) ensures that 'begin' only matches
        '<style' as a single word, followed by a whitespace or an
        ending bracket.
        */
        begin: /<style(?=\s|>)/,
        end: />/,
        keywords: { name: 'style' },
        contains: [ TAG_INTERNALS ],
        starts: {
          end: /<\/style>/,
          returnEnd: true,
          subLanguage: [
            'css',
            'xml'
          ]
        }
      },
      {
        className: 'tag',
        // See the comment in the <style tag about the lookahead pattern
        begin: /<script(?=\s|>)/,
        end: />/,
        keywords: { name: 'script' },
        contains: [ TAG_INTERNALS ],
        starts: {
          end: /<\/script>/,
          returnEnd: true,
          subLanguage: [
            'javascript',
            'handlebars',
            'xml'
          ]
        }
      },
      // we need this for now for jSX
      {
        className: 'tag',
        begin: /<>|<\/>/
      },
      // open tag
      {
        className: 'tag',
        begin: regex.concat(
          /</,
          regex.lookahead(regex.concat(
            TAG_NAME_RE,
            // <tag/>
            // <tag>
            // <tag ...
            regex.either(/\/>/, />/, /\s/)
          ))
        ),
        end: /\/?>/,
        contains: [
          {
            className: 'name',
            begin: TAG_NAME_RE,
            relevance: 0,
            starts: TAG_INTERNALS
          }
        ]
      },
      // close tag
      {
        className: 'tag',
        begin: regex.concat(
          /<\//,
          regex.lookahead(regex.concat(
            TAG_NAME_RE, />/
          ))
        ),
        contains: [
          {
            className: 'name',
            begin: TAG_NAME_RE,
            relevance: 0
          },
          {
            begin: />/,
            relevance: 0,
            endsParent: true
          }
        ]
      }
    ]
  };
}

/*
Language: JSON
Description: JSON (JavaScript Object Notation) is a lightweight data-interchange format.
Author: Ivan Sagalaev <maniac@softwaremaniacs.org>
Website: http://www.json.org
Category: common, protocols, web
*/

function json(hljs) {
  const ATTRIBUTE = {
    className: 'attr',
    begin: /"(\\.|[^\\"\r\n])*"(?=\s*:)/,
    relevance: 1.01
  };
  const PUNCTUATION = {
    match: /[{}[\],:]/,
    className: "punctuation",
    relevance: 0
  };
  const LITERALS = [
    "true",
    "false",
    "null"
  ];
  // NOTE: normally we would rely on `keywords` for this but using a mode here allows us
  // - to use the very tight `illegal: \S` rule later to flag any other character
  // - as illegal indicating that despite looking like JSON we do not truly have
  // - JSON and thus improve false-positively greatly since JSON will try and claim
  // - all sorts of JSON looking stuff
  const LITERALS_MODE = {
    scope: "literal",
    beginKeywords: LITERALS.join(" "),
  };

  return {
    name: 'JSON',
    aliases: ['jsonc'],
    keywords:{
      literal: LITERALS,
    },
    contains: [
      ATTRIBUTE,
      PUNCTUATION,
      hljs.QUOTE_STRING_MODE,
      LITERALS_MODE,
      hljs.C_NUMBER_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE
    ],
    illegal: '\\S'
  };
}

/*
Language: YAML
Description: Yet Another Markdown Language
Author: Stefan Wienert <stwienert@gmail.com>
Contributors: Carl Baxter <carl@cbax.tech>
Requires: ruby.js
Website: https://yaml.org
Category: common, config
*/
function yaml(hljs) {
  const LITERALS = 'true false yes no null';

  // YAML spec allows non-reserved URI characters in tags.
  const URI_CHARACTERS = '[\\w#;/?:@&=+$,.~*\'()[\\]]+';

  // Define keys as starting with a word character
  // ...containing word chars, spaces, colons, forward-slashes, hyphens and periods
  // ...and ending with a colon followed immediately by a space, tab or newline.
  // The YAML spec allows for much more than this, but this covers most use-cases.
  const KEY = {
    className: 'attr',
    variants: [
      // added brackets support and special char support
      { begin: /[\w*@][\w*@ :()\./-]*:(?=[ \t]|$)/ },
      { // double quoted keys - with brackets and special char support
        begin: /"[\w*@][\w*@ :()\./-]*":(?=[ \t]|$)/ },
      { // single quoted keys - with brackets and special char support
        begin: /'[\w*@][\w*@ :()\./-]*':(?=[ \t]|$)/ },
    ]
  };
  
  const TEMPLATE_VARIABLES = {
    className: 'template-variable',
    variants: [
      { // jinja templates Ansible
        begin: /\{\{/,
        end: /\}\}/
      },
      { // Ruby i18n
        begin: /%\{/,
        end: /\}/
      }
    ]
  };

  const SINGLE_QUOTE_STRING = {
    className: 'string',
    relevance: 0,
    begin: /'/,
    end: /'/,
    contains: [
      {
        match: /''/,
        scope: 'char.escape',
        relevance: 0
      }
    ]
  };

  const STRING = {
    className: 'string',
    relevance: 0,
    variants: [
      {
        begin: /"/,
        end: /"/
      },
      { begin: /\S+/ }
    ],
    contains: [
      hljs.BACKSLASH_ESCAPE,
      TEMPLATE_VARIABLES
    ]
  };

  // Strings inside of value containers (objects) can't contain braces,
  // brackets, or commas
  const CONTAINER_STRING = hljs.inherit(STRING, { variants: [
    {
      begin: /'/,
      end: /'/,
      contains: [
        {
          begin: /''/,
          relevance: 0
        }
      ]
    },
    {
      begin: /"/,
      end: /"/
    },
    { begin: /[^\s,{}[\]]+/ }
  ] });

  const DATE_RE = '[0-9]{4}(-[0-9][0-9]){0,2}';
  const TIME_RE = '([Tt \\t][0-9][0-9]?(:[0-9][0-9]){2})?';
  const FRACTION_RE = '(\\.[0-9]*)?';
  const ZONE_RE = '([ \\t])*(Z|[-+][0-9][0-9]?(:[0-9][0-9])?)?';
  const TIMESTAMP = {
    className: 'number',
    begin: '\\b' + DATE_RE + TIME_RE + FRACTION_RE + ZONE_RE + '\\b'
  };

  const VALUE_CONTAINER = {
    end: ',',
    endsWithParent: true,
    excludeEnd: true,
    keywords: LITERALS,
    relevance: 0
  };
  const OBJECT = {
    begin: /\{/,
    end: /\}/,
    contains: [ VALUE_CONTAINER ],
    illegal: '\\n',
    relevance: 0
  };
  const ARRAY = {
    begin: '\\[',
    end: '\\]',
    contains: [ VALUE_CONTAINER ],
    illegal: '\\n',
    relevance: 0
  };

  const MODES = [
    KEY,
    {
      className: 'meta',
      begin: '^---\\s*$',
      relevance: 10
    },
    { // multi line string
      // Blocks start with a | or > followed by a newline
      //
      // Indentation of subsequent lines must be the same to
      // be considered part of the block
      className: 'string',
      begin: '[\\|>]([1-9]?[+-])?[ ]*\\n( +)[^ ][^\\n]*\\n(\\2[^\\n]+\\n?)*'
    },
    { // Ruby/Rails erb
      begin: '<%[%=-]?',
      end: '[%-]?%>',
      subLanguage: 'ruby',
      excludeBegin: true,
      excludeEnd: true,
      relevance: 0
    },
    { // named tags
      className: 'type',
      begin: '!\\w+!' + URI_CHARACTERS
    },
    // https://yaml.org/spec/1.2/spec.html#id2784064
    { // verbatim tags
      className: 'type',
      begin: '!<' + URI_CHARACTERS + ">"
    },
    { // primary tags
      className: 'type',
      begin: '!' + URI_CHARACTERS
    },
    { // secondary tags
      className: 'type',
      begin: '!!' + URI_CHARACTERS
    },
    { // fragment id &ref
      className: 'meta',
      begin: '&' + hljs.UNDERSCORE_IDENT_RE + '$'
    },
    { // fragment reference *ref
      className: 'meta',
      begin: '\\*' + hljs.UNDERSCORE_IDENT_RE + '$'
    },
    { // array listing
      className: 'bullet',
      // TODO: remove |$ hack when we have proper look-ahead support
      begin: '-(?=[ ]|$)',
      relevance: 0
    },
    hljs.HASH_COMMENT_MODE,
    {
      beginKeywords: LITERALS,
      keywords: { literal: LITERALS }
    },
    TIMESTAMP,
    // numbers are any valid C-style number that
    // sit isolated from other words
    {
      className: 'number',
      begin: hljs.C_NUMBER_RE + '\\b',
      relevance: 0
    },
    OBJECT,
    ARRAY,
    SINGLE_QUOTE_STRING,
    STRING
  ];

  const VALUE_MODES = [ ...MODES ];
  VALUE_MODES.pop();
  VALUE_MODES.push(CONTAINER_STRING);
  VALUE_CONTAINER.contains = VALUE_MODES;

  return {
    name: 'YAML',
    case_insensitive: true,
    aliases: [ 'yml' ],
    contains: MODES
  };
}

/*
Language: Bash
Author: vah <vahtenberg@gmail.com>
Contributrors: Benjamin Pannell <contact@sierrasoftworks.com>
Website: https://www.gnu.org/software/bash/
Category: common, scripting
*/

/** @type LanguageFn */
function bash(hljs) {
  const regex = hljs.regex;
  const VAR = {};
  const BRACED_VAR = {
    begin: /\$\{/,
    end: /\}/,
    contains: [
      "self",
      {
        begin: /:-/,
        contains: [ VAR ]
      } // default values
    ]
  };
  Object.assign(VAR, {
    className: 'variable',
    variants: [
      { begin: regex.concat(/\$[\w\d#@][\w\d_]*/,
        // negative look-ahead tries to avoid matching patterns that are not
        // Perl at all like $ident$, @ident@, etc.
        `(?![\\w\\d])(?![$])`) },
      BRACED_VAR
    ]
  });

  const SUBST = {
    className: 'subst',
    begin: /\$\(/,
    end: /\)/,
    contains: [ hljs.BACKSLASH_ESCAPE ]
  };
  const COMMENT = hljs.inherit(
    hljs.COMMENT(),
    {
      match: [
        /(^|\s)/,
        /#.*$/
      ],
      scope: {
        2: 'comment'
      }
    }
  );
  const HERE_DOC = {
    begin: /<<-?\s*(?=\w+)/,
    starts: { contains: [
      hljs.END_SAME_AS_BEGIN({
        begin: /(\w+)/,
        end: /(\w+)/,
        className: 'string'
      })
    ] }
  };
  const QUOTE_STRING = {
    className: 'string',
    begin: /"/,
    end: /"/,
    contains: [
      hljs.BACKSLASH_ESCAPE,
      VAR,
      SUBST
    ]
  };
  SUBST.contains.push(QUOTE_STRING);
  const ESCAPED_QUOTE = {
    match: /\\"/
  };
  const APOS_STRING = {
    className: 'string',
    begin: /'/,
    end: /'/
  };
  const ESCAPED_APOS = {
    match: /\\'/
  };
  const ARITHMETIC = {
    begin: /\$?\(\(/,
    end: /\)\)/,
    contains: [
      {
        begin: /\d+#[0-9a-f]+/,
        className: "number"
      },
      hljs.NUMBER_MODE,
      VAR
    ]
  };
  const SH_LIKE_SHELLS = [
    "fish",
    "bash",
    "zsh",
    "sh",
    "csh",
    "ksh",
    "tcsh",
    "dash",
    "scsh",
  ];
  const KNOWN_SHEBANG = hljs.SHEBANG({
    binary: `(${SH_LIKE_SHELLS.join("|")})`,
    relevance: 10
  });
  const FUNCTION = {
    className: 'function',
    begin: /\w[\w\d_]*\s*\(\s*\)\s*\{/,
    returnBegin: true,
    contains: [ hljs.inherit(hljs.TITLE_MODE, { begin: /\w[\w\d_]*/ }) ],
    relevance: 0
  };

  const KEYWORDS = [
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "time",
    "for",
    "while",
    "until",
    "in",
    "do",
    "done",
    "case",
    "esac",
    "coproc",
    "function",
    "select"
  ];

  const LITERALS = [
    "true",
    "false"
  ];

  // to consume paths to prevent keyword matches inside them
  const PATH_MODE = { match: /(\/[a-z._-]+)+/ };

  // http://www.gnu.org/software/bash/manual/html_node/Shell-Builtin-Commands.html
  const SHELL_BUILT_INS = [
    "break",
    "cd",
    "continue",
    "eval",
    "exec",
    "exit",
    "export",
    "getopts",
    "hash",
    "pwd",
    "readonly",
    "return",
    "shift",
    "test",
    "times",
    "trap",
    "umask",
    "unset"
  ];

  const BASH_BUILT_INS = [
    "alias",
    "bind",
    "builtin",
    "caller",
    "command",
    "declare",
    "echo",
    "enable",
    "help",
    "let",
    "local",
    "logout",
    "mapfile",
    "printf",
    "read",
    "readarray",
    "source",
    "sudo",
    "type",
    "typeset",
    "ulimit",
    "unalias"
  ];

  const ZSH_BUILT_INS = [
    "autoload",
    "bg",
    "bindkey",
    "bye",
    "cap",
    "chdir",
    "clone",
    "comparguments",
    "compcall",
    "compctl",
    "compdescribe",
    "compfiles",
    "compgroups",
    "compquote",
    "comptags",
    "comptry",
    "compvalues",
    "dirs",
    "disable",
    "disown",
    "echotc",
    "echoti",
    "emulate",
    "fc",
    "fg",
    "float",
    "functions",
    "getcap",
    "getln",
    "history",
    "integer",
    "jobs",
    "kill",
    "limit",
    "log",
    "noglob",
    "popd",
    "print",
    "pushd",
    "pushln",
    "rehash",
    "sched",
    "setcap",
    "setopt",
    "stat",
    "suspend",
    "ttyctl",
    "unfunction",
    "unhash",
    "unlimit",
    "unsetopt",
    "vared",
    "wait",
    "whence",
    "where",
    "which",
    "zcompile",
    "zformat",
    "zftp",
    "zle",
    "zmodload",
    "zparseopts",
    "zprof",
    "zpty",
    "zregexparse",
    "zsocket",
    "zstyle",
    "ztcp"
  ];

  const GNU_CORE_UTILS = [
    "chcon",
    "chgrp",
    "chown",
    "chmod",
    "cp",
    "dd",
    "df",
    "dir",
    "dircolors",
    "ln",
    "ls",
    "mkdir",
    "mkfifo",
    "mknod",
    "mktemp",
    "mv",
    "realpath",
    "rm",
    "rmdir",
    "shred",
    "sync",
    "touch",
    "truncate",
    "vdir",
    "b2sum",
    "base32",
    "base64",
    "cat",
    "cksum",
    "comm",
    "csplit",
    "cut",
    "expand",
    "fmt",
    "fold",
    "head",
    "join",
    "md5sum",
    "nl",
    "numfmt",
    "od",
    "paste",
    "ptx",
    "pr",
    "sha1sum",
    "sha224sum",
    "sha256sum",
    "sha384sum",
    "sha512sum",
    "shuf",
    "sort",
    "split",
    "sum",
    "tac",
    "tail",
    "tr",
    "tsort",
    "unexpand",
    "uniq",
    "wc",
    "arch",
    "basename",
    "chroot",
    "date",
    "dirname",
    "du",
    "echo",
    "env",
    "expr",
    "factor",
    // "false", // keyword literal already
    "groups",
    "hostid",
    "id",
    "link",
    "logname",
    "nice",
    "nohup",
    "nproc",
    "pathchk",
    "pinky",
    "printenv",
    "printf",
    "pwd",
    "readlink",
    "runcon",
    "seq",
    "sleep",
    "stat",
    "stdbuf",
    "stty",
    "tee",
    "test",
    "timeout",
    // "true", // keyword literal already
    "tty",
    "uname",
    "unlink",
    "uptime",
    "users",
    "who",
    "whoami",
    "yes"
  ];

  return {
    name: 'Bash',
    aliases: [
      'sh',
      'zsh'
    ],
    keywords: {
      $pattern: /\b[a-z][a-z0-9._-]+\b/,
      keyword: KEYWORDS,
      literal: LITERALS,
      built_in: [
        ...SHELL_BUILT_INS,
        ...BASH_BUILT_INS,
        // Shell modifiers
        "set",
        "shopt",
        ...ZSH_BUILT_INS,
        ...GNU_CORE_UTILS
      ]
    },
    contains: [
      KNOWN_SHEBANG, // to catch known shells and boost relevancy
      hljs.SHEBANG(), // to catch unknown shells but still highlight the shebang
      FUNCTION,
      ARITHMETIC,
      COMMENT,
      HERE_DOC,
      PATH_MODE,
      QUOTE_STRING,
      ESCAPED_QUOTE,
      APOS_STRING,
      ESCAPED_APOS,
      VAR
    ]
  };
}

/*
 Language: SQL
 Website: https://en.wikipedia.org/wiki/SQL
 Category: common, database
 */

/*

Goals:

SQL is intended to highlight basic/common SQL keywords and expressions

- If pretty much every single SQL server includes supports, then it's a canidate.
- It is NOT intended to include tons of vendor specific keywords (Oracle, MySQL,
  PostgreSQL) although the list of data types is purposely a bit more expansive.
- For more specific SQL grammars please see:
  - PostgreSQL and PL/pgSQL - core
  - T-SQL - https://github.com/highlightjs/highlightjs-tsql
  - sql_more (core)

 */

function sql(hljs) {
  const regex = hljs.regex;
  const COMMENT_MODE = hljs.COMMENT('--', '$');
  const STRING = {
    scope: 'string',
    variants: [
      {
        begin: /'/,
        end: /'/,
        contains: [ { match: /''/ } ]
      }
    ]
  };
  const QUOTED_IDENTIFIER = {
    begin: /"/,
    end: /"/,
    contains: [ { match: /""/ } ]
  };

  const LITERALS = [
    "true",
    "false",
    // Not sure it's correct to call NULL literal, and clauses like IS [NOT] NULL look strange that way.
    // "null",
    "unknown"
  ];

  const MULTI_WORD_TYPES = [
    "double precision",
    "large object",
    "with timezone",
    "without timezone"
  ];

  const TYPES = [
    'bigint',
    'binary',
    'blob',
    'boolean',
    'char',
    'character',
    'clob',
    'date',
    'dec',
    'decfloat',
    'decimal',
    'float',
    'int',
    'integer',
    'interval',
    'nchar',
    'nclob',
    'national',
    'numeric',
    'real',
    'row',
    'smallint',
    'time',
    'timestamp',
    'varchar',
    'varying', // modifier (character varying)
    'varbinary'
  ];

  const NON_RESERVED_WORDS = [
    "add",
    "asc",
    "collation",
    "desc",
    "final",
    "first",
    "last",
    "view"
  ];

  // https://jakewheat.github.io/sql-overview/sql-2016-foundation-grammar.html#reserved-word
  const RESERVED_WORDS = [
    "abs",
    "acos",
    "all",
    "allocate",
    "alter",
    "and",
    "any",
    "are",
    "array",
    "array_agg",
    "array_max_cardinality",
    "as",
    "asensitive",
    "asin",
    "asymmetric",
    "at",
    "atan",
    "atomic",
    "authorization",
    "avg",
    "begin",
    "begin_frame",
    "begin_partition",
    "between",
    "bigint",
    "binary",
    "blob",
    "boolean",
    "both",
    "by",
    "call",
    "called",
    "cardinality",
    "cascaded",
    "case",
    "cast",
    "ceil",
    "ceiling",
    "char",
    "char_length",
    "character",
    "character_length",
    "check",
    "classifier",
    "clob",
    "close",
    "coalesce",
    "collate",
    "collect",
    "column",
    "commit",
    "condition",
    "connect",
    "constraint",
    "contains",
    "convert",
    "copy",
    "corr",
    "corresponding",
    "cos",
    "cosh",
    "count",
    "covar_pop",
    "covar_samp",
    "create",
    "cross",
    "cube",
    "cume_dist",
    "current",
    "current_catalog",
    "current_date",
    "current_default_transform_group",
    "current_path",
    "current_role",
    "current_row",
    "current_schema",
    "current_time",
    "current_timestamp",
    "current_path",
    "current_role",
    "current_transform_group_for_type",
    "current_user",
    "cursor",
    "cycle",
    "date",
    "day",
    "deallocate",
    "dec",
    "decimal",
    "decfloat",
    "declare",
    "default",
    "define",
    "delete",
    "dense_rank",
    "deref",
    "describe",
    "deterministic",
    "disconnect",
    "distinct",
    "double",
    "drop",
    "dynamic",
    "each",
    "element",
    "else",
    "empty",
    "end",
    "end_frame",
    "end_partition",
    "end-exec",
    "equals",
    "escape",
    "every",
    "except",
    "exec",
    "execute",
    "exists",
    "exp",
    "external",
    "extract",
    "false",
    "fetch",
    "filter",
    "first_value",
    "float",
    "floor",
    "for",
    "foreign",
    "frame_row",
    "free",
    "from",
    "full",
    "function",
    "fusion",
    "get",
    "global",
    "grant",
    "group",
    "grouping",
    "groups",
    "having",
    "hold",
    "hour",
    "identity",
    "in",
    "indicator",
    "initial",
    "inner",
    "inout",
    "insensitive",
    "insert",
    "int",
    "integer",
    "intersect",
    "intersection",
    "interval",
    "into",
    "is",
    "join",
    "json_array",
    "json_arrayagg",
    "json_exists",
    "json_object",
    "json_objectagg",
    "json_query",
    "json_table",
    "json_table_primitive",
    "json_value",
    "lag",
    "language",
    "large",
    "last_value",
    "lateral",
    "lead",
    "leading",
    "left",
    "like",
    "like_regex",
    "listagg",
    "ln",
    "local",
    "localtime",
    "localtimestamp",
    "log",
    "log10",
    "lower",
    "match",
    "match_number",
    "match_recognize",
    "matches",
    "max",
    "member",
    "merge",
    "method",
    "min",
    "minute",
    "mod",
    "modifies",
    "module",
    "month",
    "multiset",
    "national",
    "natural",
    "nchar",
    "nclob",
    "new",
    "no",
    "none",
    "normalize",
    "not",
    "nth_value",
    "ntile",
    "null",
    "nullif",
    "numeric",
    "octet_length",
    "occurrences_regex",
    "of",
    "offset",
    "old",
    "omit",
    "on",
    "one",
    "only",
    "open",
    "or",
    "order",
    "out",
    "outer",
    "over",
    "overlaps",
    "overlay",
    "parameter",
    "partition",
    "pattern",
    "per",
    "percent",
    "percent_rank",
    "percentile_cont",
    "percentile_disc",
    "period",
    "portion",
    "position",
    "position_regex",
    "power",
    "precedes",
    "precision",
    "prepare",
    "primary",
    "procedure",
    "ptf",
    "range",
    "rank",
    "reads",
    "real",
    "recursive",
    "ref",
    "references",
    "referencing",
    "regr_avgx",
    "regr_avgy",
    "regr_count",
    "regr_intercept",
    "regr_r2",
    "regr_slope",
    "regr_sxx",
    "regr_sxy",
    "regr_syy",
    "release",
    "result",
    "return",
    "returns",
    "revoke",
    "right",
    "rollback",
    "rollup",
    "row",
    "row_number",
    "rows",
    "running",
    "savepoint",
    "scope",
    "scroll",
    "search",
    "second",
    "seek",
    "select",
    "sensitive",
    "session_user",
    "set",
    "show",
    "similar",
    "sin",
    "sinh",
    "skip",
    "smallint",
    "some",
    "specific",
    "specifictype",
    "sql",
    "sqlexception",
    "sqlstate",
    "sqlwarning",
    "sqrt",
    "start",
    "static",
    "stddev_pop",
    "stddev_samp",
    "submultiset",
    "subset",
    "substring",
    "substring_regex",
    "succeeds",
    "sum",
    "symmetric",
    "system",
    "system_time",
    "system_user",
    "table",
    "tablesample",
    "tan",
    "tanh",
    "then",
    "time",
    "timestamp",
    "timezone_hour",
    "timezone_minute",
    "to",
    "trailing",
    "translate",
    "translate_regex",
    "translation",
    "treat",
    "trigger",
    "trim",
    "trim_array",
    "true",
    "truncate",
    "uescape",
    "union",
    "unique",
    "unknown",
    "unnest",
    "update",
    "upper",
    "user",
    "using",
    "value",
    "values",
    "value_of",
    "var_pop",
    "var_samp",
    "varbinary",
    "varchar",
    "varying",
    "versioning",
    "when",
    "whenever",
    "where",
    "width_bucket",
    "window",
    "with",
    "within",
    "without",
    "year",
  ];

  // these are reserved words we have identified to be functions
  // and should only be highlighted in a dispatch-like context
  // ie, array_agg(...), etc.
  const RESERVED_FUNCTIONS = [
    "abs",
    "acos",
    "array_agg",
    "asin",
    "atan",
    "avg",
    "cast",
    "ceil",
    "ceiling",
    "coalesce",
    "corr",
    "cos",
    "cosh",
    "count",
    "covar_pop",
    "covar_samp",
    "cume_dist",
    "dense_rank",
    "deref",
    "element",
    "exp",
    "extract",
    "first_value",
    "floor",
    "json_array",
    "json_arrayagg",
    "json_exists",
    "json_object",
    "json_objectagg",
    "json_query",
    "json_table",
    "json_table_primitive",
    "json_value",
    "lag",
    "last_value",
    "lead",
    "listagg",
    "ln",
    "log",
    "log10",
    "lower",
    "max",
    "min",
    "mod",
    "nth_value",
    "ntile",
    "nullif",
    "percent_rank",
    "percentile_cont",
    "percentile_disc",
    "position",
    "position_regex",
    "power",
    "rank",
    "regr_avgx",
    "regr_avgy",
    "regr_count",
    "regr_intercept",
    "regr_r2",
    "regr_slope",
    "regr_sxx",
    "regr_sxy",
    "regr_syy",
    "row_number",
    "sin",
    "sinh",
    "sqrt",
    "stddev_pop",
    "stddev_samp",
    "substring",
    "substring_regex",
    "sum",
    "tan",
    "tanh",
    "translate",
    "translate_regex",
    "treat",
    "trim",
    "trim_array",
    "unnest",
    "upper",
    "value_of",
    "var_pop",
    "var_samp",
    "width_bucket",
  ];

  // these functions can
  const POSSIBLE_WITHOUT_PARENS = [
    "current_catalog",
    "current_date",
    "current_default_transform_group",
    "current_path",
    "current_role",
    "current_schema",
    "current_transform_group_for_type",
    "current_user",
    "session_user",
    "system_time",
    "system_user",
    "current_time",
    "localtime",
    "current_timestamp",
    "localtimestamp"
  ];

  // those exist to boost relevance making these very
  // "SQL like" keyword combos worth +1 extra relevance
  const COMBOS = [
    "create table",
    "insert into",
    "primary key",
    "foreign key",
    "not null",
    "alter table",
    "add constraint",
    "grouping sets",
    "on overflow",
    "character set",
    "respect nulls",
    "ignore nulls",
    "nulls first",
    "nulls last",
    "depth first",
    "breadth first"
  ];

  const FUNCTIONS = RESERVED_FUNCTIONS;

  const KEYWORDS = [
    ...RESERVED_WORDS,
    ...NON_RESERVED_WORDS
  ].filter((keyword) => {
    return !RESERVED_FUNCTIONS.includes(keyword);
  });

  const VARIABLE = {
    scope: "variable",
    match: /@[a-z0-9][a-z0-9_]*/,
  };

  const OPERATOR = {
    scope: "operator",
    match: /[-+*/=%^~]|&&?|\|\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,
    relevance: 0,
  };

  const FUNCTION_CALL = {
    match: regex.concat(/\b/, regex.either(...FUNCTIONS), /\s*\(/),
    relevance: 0,
    keywords: { built_in: FUNCTIONS }
  };

  // turns a multi-word keyword combo into a regex that doesn't
  // care about extra whitespace etc.
  // input: "START QUERY"
  // output: /\bSTART\s+QUERY\b/
  function kws_to_regex(list) {
    return regex.concat(
      /\b/,
      regex.either(...list.map((kw) => {
        return kw.replace(/\s+/, "\\s+")
      })),
      /\b/
    )
  }

  const MULTI_WORD_KEYWORDS = {
    scope: "keyword",
    match: kws_to_regex(COMBOS),
    relevance: 0,
  };

  // keywords with less than 3 letters are reduced in relevancy
  function reduceRelevancy(list, {
    exceptions, when
  } = {}) {
    const qualifyFn = when;
    exceptions = exceptions || [];
    return list.map((item) => {
      if (item.match(/\|\d+$/) || exceptions.includes(item)) {
        return item;
      } else if (qualifyFn(item)) {
        return `${item}|0`;
      } else {
        return item;
      }
    });
  }

  return {
    name: 'SQL',
    case_insensitive: true,
    // does not include {} or HTML tags `</`
    illegal: /[{}]|<\//,
    keywords: {
      $pattern: /\b[\w\.]+/,
      keyword:
        reduceRelevancy(KEYWORDS, { when: (x) => x.length < 3 }),
      literal: LITERALS,
      type: TYPES,
      built_in: POSSIBLE_WITHOUT_PARENS
    },
    contains: [
      {
        scope: "type",
        match: kws_to_regex(MULTI_WORD_TYPES)
      },
      MULTI_WORD_KEYWORDS,
      FUNCTION_CALL,
      VARIABLE,
      STRING,
      QUOTED_IDENTIFIER,
      hljs.C_NUMBER_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      COMMENT_MODE,
      OPERATOR
    ]
  };
}

/*
Language: Markdown
Requires: xml.js
Author: John Crepezzi <john.crepezzi@gmail.com>
Website: https://daringfireball.net/projects/markdown/
Category: common, markup
*/

function markdown(hljs) {
  const regex = hljs.regex;
  const INLINE_HTML = {
    begin: /<\/?[A-Za-z_]/,
    end: '>',
    subLanguage: 'xml',
    relevance: 0
  };
  const HORIZONTAL_RULE = {
    begin: '^[-\\*]{3,}',
    end: '$'
  };
  const CODE = {
    className: 'code',
    variants: [
      // TODO: fix to allow these to work with sublanguage also
      { begin: '(`{3,})[^`](.|\\n)*?\\1`*[ ]*' },
      { begin: '(~{3,})[^~](.|\\n)*?\\1~*[ ]*' },
      // needed to allow markdown as a sublanguage to work
      {
        begin: '```',
        end: '```+[ ]*$'
      },
      {
        begin: '~~~',
        end: '~~~+[ ]*$'
      },
      { begin: '`.+?`' },
      {
        begin: '(?=^( {4}|\\t))',
        // use contains to gobble up multiple lines to allow the block to be whatever size
        // but only have a single open/close tag vs one per line
        contains: [
          {
            begin: '^( {4}|\\t)',
            end: '(\\n)$'
          }
        ],
        relevance: 0
      }
    ]
  };
  const LIST = {
    className: 'bullet',
    begin: '^[ \t]*([*+-]|(\\d+\\.))(?=\\s+)',
    end: '\\s+',
    excludeEnd: true
  };
  const LINK_REFERENCE = {
    begin: /^\[[^\n]+\]:/,
    returnBegin: true,
    contains: [
      {
        className: 'symbol',
        begin: /\[/,
        end: /\]/,
        excludeBegin: true,
        excludeEnd: true
      },
      {
        className: 'link',
        begin: /:\s*/,
        end: /$/,
        excludeBegin: true
      }
    ]
  };
  const URL_SCHEME = /[A-Za-z][A-Za-z0-9+.-]*/;
  const LINK = {
    variants: [
      // too much like nested array access in so many languages
      // to have any real relevance
      {
        begin: /\[.+?\]\[.*?\]/,
        relevance: 0
      },
      // popular internet URLs
      {
        begin: /\[.+?\]\(((data|javascript|mailto):|(?:http|ftp)s?:\/\/).*?\)/,
        relevance: 2
      },
      {
        begin: regex.concat(/\[.+?\]\(/, URL_SCHEME, /:\/\/.*?\)/),
        relevance: 2
      },
      // relative urls
      {
        begin: /\[.+?\]\([./?&#].*?\)/,
        relevance: 1
      },
      // whatever else, lower relevance (might not be a link at all)
      {
        begin: /\[.*?\]\(.*?\)/,
        relevance: 0
      }
    ],
    returnBegin: true,
    contains: [
      {
        // empty strings for alt or link text
        match: /\[(?=\])/ },
      {
        className: 'string',
        relevance: 0,
        begin: '\\[',
        end: '\\]',
        excludeBegin: true,
        returnEnd: true
      },
      {
        className: 'link',
        relevance: 0,
        begin: '\\]\\(',
        end: '\\)',
        excludeBegin: true,
        excludeEnd: true
      },
      {
        className: 'symbol',
        relevance: 0,
        begin: '\\]\\[',
        end: '\\]',
        excludeBegin: true,
        excludeEnd: true
      }
    ]
  };
  const BOLD = {
    className: 'strong',
    contains: [], // defined later
    variants: [
      {
        begin: /_{2}(?!\s)/,
        end: /_{2}/
      },
      {
        begin: /\*{2}(?!\s)/,
        end: /\*{2}/
      }
    ]
  };
  const ITALIC = {
    className: 'emphasis',
    contains: [], // defined later
    variants: [
      {
        begin: /\*(?![*\s])/,
        end: /\*/
      },
      {
        begin: /_(?![_\s])/,
        end: /_/,
        relevance: 0
      }
    ]
  };

  // 3 level deep nesting is not allowed because it would create confusion
  // in cases like `***testing***` because where we don't know if the last
  // `***` is starting a new bold/italic or finishing the last one
  const BOLD_WITHOUT_ITALIC = hljs.inherit(BOLD, { contains: [] });
  const ITALIC_WITHOUT_BOLD = hljs.inherit(ITALIC, { contains: [] });
  BOLD.contains.push(ITALIC_WITHOUT_BOLD);
  ITALIC.contains.push(BOLD_WITHOUT_ITALIC);

  let CONTAINABLE = [
    INLINE_HTML,
    LINK
  ];

  [
    BOLD,
    ITALIC,
    BOLD_WITHOUT_ITALIC,
    ITALIC_WITHOUT_BOLD
  ].forEach(m => {
    m.contains = m.contains.concat(CONTAINABLE);
  });

  CONTAINABLE = CONTAINABLE.concat(BOLD, ITALIC);

  const HEADER = {
    className: 'section',
    variants: [
      {
        begin: '^#{1,6}',
        end: '$',
        contains: CONTAINABLE
      },
      {
        begin: '(?=^.+?\\n[=-]{2,}$)',
        contains: [
          { begin: '^[=-]*$' },
          {
            begin: '^',
            end: "\\n",
            contains: CONTAINABLE
          }
        ]
      }
    ]
  };

  const BLOCKQUOTE = {
    className: 'quote',
    begin: '^>\\s+',
    contains: CONTAINABLE,
    end: '$'
  };

  const ENTITY = {
    //https://spec.commonmark.org/0.31.2/#entity-references
    scope: 'literal',
    match: /&([a-zA-Z0-9]+|#[0-9]{1,7}|#[Xx][0-9a-fA-F]{1,6});/
  };

  return {
    name: 'Markdown',
    aliases: [
      'md',
      'mkdown',
      'mkd'
    ],
    contains: [
      HEADER,
      INLINE_HTML,
      LIST,
      BOLD,
      ITALIC,
      BLOCKQUOTE,
      CODE,
      HORIZONTAL_RULE,
      LINK,
      LINK_REFERENCE,
      ENTITY
    ]
  };
}

/*
Language: Diff
Description: Unified and context diff
Author: Vasily Polovnyov <vast@whiteants.net>
Website: https://www.gnu.org/software/diffutils/
Category: common
*/

/** @type LanguageFn */
function diff(hljs) {
  const regex = hljs.regex;
  return {
    name: 'Diff',
    aliases: [ 'patch' ],
    contains: [
      {
        className: 'meta',
        relevance: 10,
        match: regex.either(
          /^@@ +-\d+,\d+ +\+\d+,\d+ +@@/,
          /^\*\*\* +\d+,\d+ +\*\*\*\*$/,
          /^--- +\d+,\d+ +----$/
        )
      },
      {
        className: 'comment',
        variants: [
          {
            begin: regex.either(
              /Index: /,
              /^index/,
              /={3,}/,
              /^-{3}/,
              /^\*{3} /,
              /^\+{3}/,
              /^diff --git/
            ),
            end: /$/
          },
          { match: /^\*{15}$/ }
        ]
      },
      {
        className: 'addition',
        begin: /^\+/,
        end: /$/
      },
      {
        className: 'deletion',
        begin: /^-/,
        end: /$/
      },
      {
        className: 'addition',
        begin: /^!/,
        end: /$/
      }
    ]
  };
}

const LANGUAGES = [
  ["typescript", typescript],
  ["javascript", javascript],
  ["python", python],
  ["rust", rust],
  ["go", go],
  ["java", java],
  ["cpp", cpp],
  ["css", css],
  ["xml", xml],
  ["json", json],
  ["yaml", yaml],
  ["bash", bash],
  ["sql", sql],
  ["markdown", markdown],
  ["diff", diff]
];
for (const [name, lang] of LANGUAGES) HighlightJS.registerLanguage(name, lang);
const EXT_LANG = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  css: "css",
  scss: "css",
  less: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  md: "markdown",
  mdx: "markdown",
  diff: "diff",
  patch: "diff"
};
function extToLang(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}
d.setOptions({ async: false, gfm: true, breaks: false });
d.use({
  renderer: {
    code({ text, lang }) {
      const language = lang && HighlightJS.getLanguage(lang) ? lang : "";
      if (!language) return `<pre><code>${escapeHtml(text)}</code></pre>`;
      const highlighted = HighlightJS.highlight(text, { language }).value;
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
    },
    codespan({ text }) {
      const path = extractFilePath$1(text);
      if (path) {
        const { display, target } = path;
        return `<code><a class="file-link" href="#" data-file-path="${escapeAttr(target)}">${escapeHtml(display)}</a></code>`;
      }
      return `<code>${escapeHtml(text)}</code>`;
    }
  }
});
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
const FILE_EXT_RE = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs|json|jsonc|md|mdx|css|scss|less|html|htm|xml|svg|yaml|yml|toml|py|pyi|rs|go|java|c|h|cpp|cc|cxx|hpp|sh|bash|zsh|sql|rb|php|lua|kt|swift|dart|vue|astro|conf|ini|env|lock|txt)$/i;
function extractFilePath$1(text) {
  const s = text.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  if (/\s/.test(s)) return null;
  if (s.startsWith("-")) return null;
  const locMatch = s.match(/^(.+?)(:\d+(?::\d+)?)$/);
  const pathPart = locMatch ? locMatch[1] : s;
  if (!/^[\w./\\@~-]+$/.test(pathPart)) return null;
  const hasSlash = /[\/\\]/.test(pathPart);
  const hasFileExt = FILE_EXT_RE.test(pathPart);
  if (!hasSlash && !hasFileExt) return null;
  if (/^\.\w+$/.test(pathPart)) return null;
  return { display: s, target: pathPart };
}
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderMarkdown(text) {
  return d.parse(text);
}
const CODE_TRUNCATE_LINES = 100;
function renderCodeBlock(content, lang, maxLines = CODE_TRUNCATE_LINES) {
  const lines = content.split("\n");
  const truncated = lines.length > maxLines;
  const display = truncated ? lines.slice(0, maxLines).join("\n") : content;
  const html = renderMarkdown("```" + lang + "\n" + display + "\n```");
  return { html, truncated, totalLines: lines.length };
}

var _tmpl$$v = /* @__PURE__ */ template(`<div class=msg-text>`);
function splitBlocks(text) {
  if (!text) return [];
  const blocks = [];
  let current = "";
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      current += (current ? "\n" : "") + line;
      continue;
    }
    if (inFence) {
      current += (current ? "\n" : "") + line;
      continue;
    }
    if (line.trim() === "") {
      if (current.trim()) {
        blocks.push(current);
      }
      current = "";
      continue;
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) blocks.push(current);
  return blocks;
}
function TextPart(props) {
  let containerRef;
  const frozen = /* @__PURE__ */ new Map();
  const frozenNodes = /* @__PURE__ */ new Map();
  let prevBlockCount = 0;
  let activeEl = null;
  createEffect(() => {
    const text = props.text || "";
    const container = containerRef;
    if (!container) return;
    const blocks = splitBlocks(text);
    const total = blocks.length;
    const frozenCount = Math.max(0, total - 1);
    for (let i = prevBlockCount; i < frozenCount; i++) {
      if (!frozen.has(i)) {
        const html = renderMarkdown(blocks[i]);
        frozen.set(i, html);
        const node = document.createElement("div");
        node.className = "md-frozen-block";
        node.innerHTML = html;
        frozenNodes.set(i, node);
        if (activeEl && activeEl.parentNode === container) {
          container.insertBefore(node, activeEl);
        } else {
          container.appendChild(node);
        }
      }
    }
    if (total > 0) {
      const activeText = blocks[total - 1];
      if (!activeEl) {
        activeEl = document.createElement("div");
        activeEl.className = "md-active-block";
        container.appendChild(activeEl);
      }
      activeEl.innerHTML = renderMarkdown(activeText);
    } else if (activeEl) {
      activeEl.innerHTML = "";
    }
    prevBlockCount = frozenCount;
  });
  onCleanup(() => {
    frozen.clear();
    frozenNodes.clear();
    activeEl = null;
    prevBlockCount = 0;
  });
  return (() => {
    var _el$ = _tmpl$$v();
    var _ref$ = containerRef;
    typeof _ref$ === "function" ? use(_ref$, _el$) : containerRef = _el$;
    return _el$;
  })();
}
function StaticTextPart(props) {
  const html = createMemo(() => renderMarkdown(props.text));
  return (() => {
    var _el$2 = _tmpl$$v();
    createRenderEffect(() => _el$2.innerHTML = html());
    return _el$2;
  })();
}

const $RAW = Symbol("store-raw"),
  $NODE = Symbol("store-node"),
  $HAS = Symbol("store-has"),
  $SELF = Symbol("store-self");
function wrap$1(value) {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, {
      value: p = new Proxy(value, proxyTraps$1)
    });
    if (!Array.isArray(value)) {
      const keys = Object.keys(value),
        desc = Object.getOwnPropertyDescriptors(value);
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          Object.defineProperty(value, prop, {
            enumerable: desc[prop].enumerable,
            get: desc[prop].get.bind(p)
          });
        }
      }
    }
  }
  return p;
}
function isWrappable(obj) {
  let proto;
  return obj != null && typeof obj === "object" && (obj[$PROXY] || !(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype || Array.isArray(obj));
}
function unwrap(item, set = new Set()) {
  let result, unwrapped, v, prop;
  if (result = item != null && item[$RAW]) return result;
  if (!isWrappable(item) || set.has(item)) return item;
  if (Array.isArray(item)) {
    if (Object.isFrozen(item)) item = item.slice(0);else set.add(item);
    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item)) item = Object.assign({}, item);else set.add(item);
    const keys = Object.keys(item),
      desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if (desc[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}
function getNodes(target, symbol) {
  let nodes = target[symbol];
  if (!nodes) Object.defineProperty(target, symbol, {
    value: nodes = Object.create(null)
  });
  return nodes;
}
function getNode(nodes, property, value) {
  if (nodes[property]) return nodes[property];
  const [s, set] = createSignal(value, {
    equals: false,
    internal: true
  });
  s.$ = set;
  return nodes[property] = s;
}
function proxyDescriptor$1(target, property) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || !desc.configurable || property === $PROXY || property === $NODE) return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}
function trackSelf(target) {
  getListener() && getNode(getNodes(target, $NODE), $SELF)();
}
function ownKeys(target) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}
const proxyTraps$1 = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getNodes(target, $NODE);
    const tracked = nodes[property];
    let value = tracked ? tracked() : target[property];
    if (property === $NODE || property === $HAS || property === "__proto__") return value;
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property)) && !(desc && desc.get)) value = getNode(nodes, property, value)();
    }
    return isWrappable(value) ? wrap$1(value) : value;
  },
  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $TRACK || property === $NODE || property === $HAS || property === "__proto__") return true;
    getListener() && getNode(getNodes(target, $HAS), property)();
    return property in target;
  },
  set() {
    return true;
  },
  deleteProperty() {
    return true;
  },
  ownKeys: ownKeys,
  getOwnPropertyDescriptor: proxyDescriptor$1
};
function setProperty(state, property, value, deleting = false) {
  if (!deleting && state[property] === value) return;
  const prev = state[property],
    len = state.length;
  if (value === undefined) {
    delete state[property];
    if (state[$HAS] && state[$HAS][property] && prev !== undefined) state[$HAS][property].$();
  } else {
    state[property] = value;
    if (state[$HAS] && state[$HAS][property] && prev === undefined) state[$HAS][property].$();
  }
  let nodes = getNodes(state, $NODE),
    node;
  if (node = getNode(nodes, property, prev)) node.$(() => value);
  if (Array.isArray(state) && state.length !== len) {
    for (let i = state.length; i < len; i++) (node = nodes[i]) && node.$();
    (node = getNode(nodes, "length", len)) && node.$(state.length);
  }
  (node = nodes[$SELF]) && node.$();
}
function mergeStoreNode(state, value) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}
function updateArray(current, next) {
  if (typeof next === "function") next = next(current);
  next = unwrap(next);
  if (Array.isArray(next)) {
    if (current === next) return;
    let i = 0,
      len = next.length;
    for (; i < len; i++) {
      const value = next[i];
      if (current[i] !== value) setProperty(current, i, value);
    }
    setProperty(current, "length", len);
  } else mergeStoreNode(current, next);
}
function updatePath(current, path, traversed = []) {
  let part,
    prev = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);
    if (Array.isArray(part)) {
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "function") {
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i)) updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "object") {
      const {
        from = 0,
        to = current.length - 1,
        by = 1
      } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    prev = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(prev, traversed);
    if (value === prev) return;
  }
  if (part === undefined && value == undefined) return;
  value = unwrap(value);
  if (part === undefined || isWrappable(prev) && isWrappable(value) && !Array.isArray(value)) {
    mergeStoreNode(prev, value);
  } else setProperty(current, part, value);
}
function createStore(...[store, options]) {
  const unwrappedStore = unwrap(store || {});
  const isArray = Array.isArray(unwrappedStore);
  const wrappedStore = wrap$1(unwrappedStore);
  function setStore(...args) {
    batch(() => {
      isArray && args.length === 1 ? updateArray(unwrappedStore, args[0]) : updatePath(unwrappedStore, args);
    });
  }
  return [wrappedStore, setStore];
}

const $ROOT = Symbol("store-root");
function applyState(target, parent, property, merge, key) {
  const previous = parent[property];
  if (target === previous) return;
  const isArray = Array.isArray(target);
  if (property !== $ROOT && (!isWrappable(target) || !isWrappable(previous) || isArray !== Array.isArray(previous) || key && target[key] !== previous[key])) {
    setProperty(parent, property, target);
    return;
  }
  if (isArray) {
    if (target.length && previous.length && (!merge || key && target[0] && target[0][key] != null)) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;
      for (start = 0, end = Math.min(previous.length, target.length); start < end && (previous[start] === target[start] || key && previous[start] && target[start] && previous[start][key] && previous[start][key] === target[start][key]); start++) {
        applyState(target[start], previous, start, merge, key);
      }
      const temp = new Array(target.length),
        newIndices = new Map();
      for (end = previous.length - 1, newEnd = target.length - 1; end >= start && newEnd >= start && (previous[end] === target[newEnd] || key && previous[end] && target[newEnd] && previous[end][key] && previous[end][key] === target[newEnd][key]); end--, newEnd--) {
        temp[newEnd] = previous[end];
      }
      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) setProperty(previous, j, target[j]);
        for (; j < target.length; j++) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        }
        if (previous.length > target.length) setProperty(previous, "length", target.length);
        return;
      }
      newIndicesNext = new Array(newEnd + 1);
      for (j = newEnd; j >= start; j--) {
        item = target[j];
        keyVal = key && item ? item[key] : item;
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }
      for (i = start; i <= end; i++) {
        item = previous[i];
        keyVal = key && item ? item[key] : item;
        j = newIndices.get(keyVal);
        if (j !== undefined && j !== -1) {
          temp[j] = previous[i];
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }
      for (j = start; j < target.length; j++) {
        if (j in temp) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        } else setProperty(previous, j, target[j]);
      }
    } else {
      for (let i = 0, len = target.length; i < len; i++) {
        applyState(target[i], previous, i, merge, key);
      }
    }
    if (previous.length > target.length) setProperty(previous, "length", target.length);
    return;
  }
  const targetKeys = Object.keys(target);
  for (let i = 0, len = targetKeys.length; i < len; i++) {
    applyState(target[targetKeys[i]], previous, targetKeys[i], merge, key);
  }
  const previousKeys = Object.keys(previous);
  for (let i = 0, len = previousKeys.length; i < len; i++) {
    if (target[previousKeys[i]] === undefined) setProperty(previous, previousKeys[i], undefined);
  }
}
function reconcile(value, options = {}) {
  const {
      merge,
      key = "id"
    } = options,
    v = unwrap(value);
  return state => {
    if (!isWrappable(state) || !isWrappable(v)) return v;
    const res = applyState(v, {
      [$ROOT]: state
    }, $ROOT, merge, key);
    return res === undefined ? state : res;
  };
}
const producers = new WeakMap();
const setterTraps = {
  get(target, property) {
    if (property === $RAW) return target;
    const value = target[property];
    let proxy;
    return isWrappable(value) ? producers.get(value) || (producers.set(value, proxy = new Proxy(value, setterTraps)), proxy) : value;
  },
  set(target, property, value) {
    setProperty(target, property, unwrap(value));
    return true;
  },
  deleteProperty(target, property) {
    setProperty(target, property, undefined, true);
    return true;
  }
};
function produce(fn) {
  return state => {
    if (isWrappable(state)) {
      let proxy;
      if (!(proxy = producers.get(state))) {
        producers.set(state, proxy = new Proxy(state, setterTraps));
      }
      fn(proxy);
    }
    return state;
  };
}

const DEFAULT_APP_STATE = {
  connectionStatus: "offline",
  connected: false,
  theme: "dark",
  locale: "en-US",
  zoom: 1,
  opacity: 0.8,
  logEntries: [],
  logFilterLevel: "debug",
  i18n: {},
  i18nReady: false,
  localeSeq: 0,
  coreVersion: "",
  config: null,
  executors: [],
  providerCatalog: null,
  providerAuth: null,
  providerAuthDismissed: {},
  providerTest: null,
  channels: [],
  skills: [],
  skillMarket: [],
  mcp: {},
  ndjsonEvents: [],
  ndjsonStartMs: 0,
  memoryFiles: [],
  memorySearchMode: false,
  promptEntries: [],
  promptDrafts: {},
  criteriaSpecs: [],
  budgetDirty: false,
  budgetSaving: false
};
const [appStore, setAppStore] = createStore({ ...DEFAULT_APP_STATE });
const LOG_LEVEL_ORDER$1 = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
const MAX_LOG_ENTRIES = 2e3;
function appendLog(entry) {
  setAppStore("logEntries", (prev) => {
    const next = [...prev, entry];
    return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
  });
}
function filteredLogEntries() {
  const min = LOG_LEVEL_ORDER$1[appStore.logFilterLevel] ?? 0;
  return appStore.logEntries.filter(
    (e) => (LOG_LEVEL_ORDER$1[e.level] ?? 0) >= min
  );
}
function setConnectionStatus(status) {
  setAppStore({
    connectionStatus: status,
    connected: status === "online"
  });
}
function setI18nReady(ready) {
  setAppStore("i18nReady", ready);
}
function setLocaleState(locale) {
  setAppStore({
    locale,
    localeSeq: appStore.localeSeq + 1
  });
}
function dismissProviderAuth(providerID) {
  setAppStore("providerAuthDismissed", (prev) => ({
    ...prev,
    [providerID]: true
  }));
}
function setProviderTest(test) {
  setAppStore("providerTest", test ?? null);
}
function setExecutors(list) {
  setAppStore("executors", Array.isArray(list) ? list : []);
}
function setSkills(list) {
  setAppStore("skills", Array.isArray(list) ? list : []);
}
function setSkillMarket(list) {
  setAppStore("skillMarket", Array.isArray(list) ? list : []);
}
function setMcp(map) {
  setAppStore(
    "mcp",
    map && typeof map === "object" && !Array.isArray(map) ? map : {}
  );
}

const SUPPORTED_LOCALES = ["zh-CN", "en-US"];
let messages = {};
let currentLocale = sanitizeLocale(
  (typeof document !== "undefined" ? document.documentElement.lang : "") || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US"
);
function record$7(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function sanitizeLocale(value) {
  const text = String(value || "").trim();
  if (SUPPORTED_LOCALES.includes(text)) return text;
  if (/^zh\b/i.test(text)) return "zh-CN";
  return "en-US";
}
function localeValue(key, locale = currentLocale) {
  appStore.localeSeq;
  const source = messages[locale];
  if (record$7(source) && Object.hasOwn(source, key)) return source[key];
  return key.split(".").reduce((acc, part) => record$7(acc) ? acc[part] : void 0, source);
}
function fillTemplate(text, vars = {}) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split(".").reduce(
      (acc, part) => record$7(acc) ? acc[part] : void 0,
      vars
    );
    return value == null ? "" : String(value);
  });
}
function t(key, vars) {
  const value = localeValue(key) ?? localeValue(key, "en-US");
  if (typeof value !== "string") return key;
  return fillTemplate(value, vars);
}
function tc(key, count, vars) {
  const value = localeValue(key) ?? localeValue(key, "en-US");
  if (record$7(value)) {
    const text = value[count === 1 ? "one" : "other"] ?? value.other ?? value.one;
    if (typeof text === "string") return fillTemplate(text, { count, ...vars });
  }
  return t(key, { count, ...vars });
}
function localeTag() {
  return sanitizeLocale(currentLocale);
}
async function loadLocale(locale) {
  const normalized = sanitizeLocale(locale);
  if (messages[normalized]) return;
  const data = await fetch(`i18n/${normalized}.json`).then((res) => res.ok ? res.json() : {}).catch(() => ({}));
  messages[normalized] = record$7(data) ? data : {};
}
async function setLocale(locale) {
  const normalized = sanitizeLocale(locale);
  await loadLocale(normalized);
  currentLocale = normalized;
  setI18nReady(true);
  if (typeof document !== "undefined") {
    document.documentElement.lang = normalized;
    applyI18n(document);
  }
  setLocaleState(normalized);
}
async function loadAllLocales() {
  const entries = await Promise.all(
    SUPPORTED_LOCALES.map(async (locale) => {
      const data = await fetch(`i18n/${locale}.json`).then((res) => res.ok ? res.json() : {}).catch(() => ({}));
      return [locale, record$7(data) ? data : {}];
    })
  );
  for (const [locale, data] of entries) {
    messages[locale] = data;
  }
  setI18nReady(true);
}
function i18nTargets(root, selector) {
  const items = [];
  if (root instanceof Element && root.matches(selector)) items.push(root);
  root.querySelectorAll?.(selector)?.forEach((node) => items.push(node));
  return items;
}
function applyI18n(root = document) {
  i18nTargets(root, "[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  i18nTargets(root, "[data-i18n-html]").forEach((node) => {
    node.innerHTML = t(node.dataset.i18nHtml);
  });
  i18nTargets(root, "[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });
  i18nTargets(root, "[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", t(node.dataset.i18nTitle));
  });
  i18nTargets(root, "[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
  i18nTargets(root, "[data-i18n-alt]").forEach((node) => {
    node.setAttribute("alt", t(node.dataset.i18nAlt));
  });
}

function stripAnsi(str) {
  if (!str) return "";
  return str.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ""
  );
}
function record$6(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function toolNameKey(name) {
  return String(name || "").toLowerCase().replace(/[\s_-]+/g, "");
}
function toolInputCommand(input) {
  if (!record$6(input)) return "";
  const value = input.command ?? input.argv ?? input.cmd;
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap(
    (item) => typeof item === "string" && item.trim() ? [item.trim()] : []
  ).join(" ").trim();
}
function relativePathFrom$1(base, target) {
  const baseText = typeof base === "string" ? base.replace(/[\\/]+$/, "") : "";
  const targetText = typeof target === "string" ? target.replace(/[\\/]+$/, "") : "";
  if (!baseText || !targetText) return "";
  const lBase = baseText.toLowerCase();
  const lTarget = targetText.toLowerCase();
  if (lTarget.startsWith(lBase + "/") || lTarget.startsWith(lBase + "\\")) {
    return targetText.slice(baseText.length + 1);
  }
  return "";
}
function shortPath$2(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}
function shortRelativePath(p, base = "") {
  if (!p) return "";
  const rel = relativePathFrom$1(base, p);
  return rel || shortPath$2(p);
}
function displayToolIcon(name) {
  const n = toolNameKey(name);
  if (n === "read" || n === "readfile") return "📄";
  if (n === "edit" || n === "editfile" || n === "applypatch") return "✏️";
  if (n === "write" || n === "writefile") return "📝";
  if (n === "bash" || n === "shellcommand" || n === "runcommand") return "💻";
  if (n === "grep" || n === "searchcode") return "🔍";
  if (n === "glob" || n === "findfiles") return "📂";
  if (n === "agent" || n === "spawnagent") return "🤖";
  if (n === "todowrite" || n === "todoupdate" || n === "updateplan") return "☑️";
  return "⚡";
}
function displayToolDetail(name, input, state, base = "") {
  const safeInput = record$6(input) ? input : {};
  const safeState = record$6(state) ? state : {};
  const n = toolNameKey(name);
  const path = safeInput.file_path || safeInput.filePath || safeInput.path || safeInput.filename || "";
  if (path) return shortRelativePath(path, base);
  if (n === "bash" || n === "shellcommand" || n === "runcommand")
    return toolInputCommand(safeInput);
  if (n === "grep" || n === "searchcode")
    return safeInput.pattern || safeInput.query || safeInput.q || "";
  if (n === "glob" || n === "findfiles")
    return safeInput.pattern || safeInput.glob || "";
  if (n === "agent" || n === "spawnagent")
    return safeInput.description || safeInput.prompt || "";
  if (typeof safeInput.raw === "string" && safeInput.raw.trim())
    return safeInput.raw.trim();
  if ((safeState.status === "completed" || safeState.status === "running") && typeof safeState.title === "string")
    return safeState.title;
  return "";
}
function toolStatusLabel(status) {
  if (status === "completed") return t("task.status.completed");
  if (status === "running") return t("common.active");
  if (status === "error") return t("common.error");
  return t("checks.pending");
}

const DEFAULT_SERVER = (() => {
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http") && window.location.pathname.startsWith("/ui")) {
    return window.location.origin;
  }
  return "http://127.0.0.1:7878";
})();
let serverUrl = DEFAULT_SERVER;
let authCredentials = { username: "opencorvus", password: "" };
let directoryContext = "";
function configure(opts) {
  if (opts.serverUrl) serverUrl = opts.serverUrl;
  if (opts.username) authCredentials.username = opts.username;
  if (opts.password !== void 0) authCredentials.password = opts.password;
  if (opts.directory !== void 0) directoryContext = String(opts.directory || "").trim();
}
function apiUrl(path) {
  const base = serverUrl.replace(/\/+$/, "");
  const next = path.replace(/^\/+/, "");
  const url = new URL(`${base}/${next}`);
  if (directoryContext && !url.searchParams.has("directory")) {
    url.searchParams.set("directory", directoryContext);
  }
  return url.toString();
}
function apiHeaders() {
  const h = { Accept: "application/json" };
  if (authCredentials.password) {
    h.Authorization = `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`;
  }
  return h;
}
async function apiJson(path, init) {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...apiHeaders(), ...init?.headers }
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

const api = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  DEFAULT_SERVER,
  apiHeaders,
  apiJson,
  apiUrl,
  configure
}, Symbol.toStringTag, { value: 'Module' }));

const [boardStore, setBoardStore] = createStore({
  board: null,
  tasks: [],
  selectedTaskID: "",
  taskSequence: 0,
  loading: false,
  // ── Task list internals (mirrors state.pendingTasks / state.tasksSeq) ──
  /** Tasks that have been created locally but not yet confirmed by the server */
  pendingTasks: [],
  /** Monotonic counter incremented on each tasks-list refresh */
  tasksSeq: 0,
  // ── Board sync internals (mirrors state.boardEtag / state.boardQueued / etc.) ──
  /** ETag of the last board response, used for conditional fetches */
  boardEtag: "",
  /** Whether a board reload is currently queued (debounce guard) */
  boardQueued: false,
  /** Retry attempt counter for board fetch failures */
  boardRetryCount: 0,
  /** Whether an in-flight board sync is pending */
  boardSyncPending: false,
  /** Unix-ms timestamp of the last successful board update */
  boardUpdatedAt: 0,
  /** Snapshot version string returned by the server with the board payload */
  snapshotVersion: "",
  // ── VCS state (mirrors state.path / state.vcs) ──
  /** Git path info object for the active working directory */
  path: null,
  /** Git / VCS status object for the active task */
  vcs: null,
  // ── File changes (mirrors state.changes) ──
  /** File change entries for the current task's working tree */
  changes: [],
  // ── Streaming previews ──
  /** Streaming preview text for the plan section */
  planPreview: "",
  /** Streaming preview text for the spec section */
  specPreview: ""
});
let _boardRetryTimer = null;
let _boardLoading = null;
let _boardQueued = false;
function boardSnapshot(board) {
  return typeof board?.snapshotVersion === "string" ? board.snapshotVersion : "";
}
function clearBoardRetry$1() {
  if (_boardRetryTimer) {
    clearTimeout(_boardRetryTimer);
    _boardRetryTimer = null;
  }
  setBoardRetryCount(0);
}
function retryBoard(sync) {
  if (!boardStore.selectedTaskID || _boardRetryTimer) return;
  if (sync) setBoardSyncPending(true);
  const delay = Math.min(1e3 * Math.pow(2, Math.min(boardStore.boardRetryCount, 4)), 15e3);
  setBoardRetryCount(boardStore.boardRetryCount + 1);
  _boardRetryTimer = setTimeout(() => {
    _boardRetryTimer = null;
    void loadBoard({ sync: boardStore.boardSyncPending });
  }, delay);
}
async function loadBoard(options = {}) {
  const taskID = boardStore.selectedTaskID;
  if (!taskID) {
    setBoardStore("board", null);
    setSnapshotVersion("");
    return;
  }
  if (options.sync) setBoardSyncPending(true);
  if (_boardLoading) {
    _boardQueued = true;
    if (options.sync) setBoardSyncPending(true);
    return _boardLoading;
  }
  const sync = options.sync === true || boardStore.boardSyncPending;
  if (sync) setBoardSyncPending(true);
  const loading = (async () => {
    let failed = false;
    try {
      const headers = apiHeaders();
      if (boardStore.boardEtag) headers["If-None-Match"] = boardStore.boardEtag;
      const res = await fetch(apiUrl(`task/${encodeURIComponent(taskID)}/board?sync=${sync ? "1" : "0"}`), {
        headers,
        signal: AbortSignal.timeout(1e4)
      });
      if (taskID !== boardStore.selectedTaskID) return;
      setBoardSyncPending(false);
      if (res.status === 304) {
        clearBoardRetry$1();
        setBoardUpdatedAt(Date.now());
        return;
      }
      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
      const etag = res.headers.get("etag");
      if (etag) setBoardEtag(etag);
      const data = await res.json();
      const lastSequence = Number(data?.lastSequence || 0);
      if (Number.isFinite(lastSequence) && lastSequence > 0 && boardStore.taskSequence > 0 && lastSequence < boardStore.taskSequence) {
        clearBoardRetry$1();
        return;
      }
      setBoardStore("board", data ?? null);
      setSnapshotVersion(boardSnapshot(data));
      if (Number.isFinite(lastSequence) && lastSequence > 0) {
        setTaskSequence(lastSequence);
      }
      clearBoardRetry$1();
      setBoardUpdatedAt(Date.now());
    } catch (e) {
      failed = true;
      console.error("loadBoard failed", e);
      if (taskID === boardStore.selectedTaskID) retryBoard(sync);
    } finally {
      _boardLoading = null;
      setBoardStore("loading", false);
      if (_boardQueued || boardStore.boardQueued) {
        _boardQueued = false;
        setBoardQueued(false);
        if (!failed && !_boardRetryTimer) {
          queueMicrotask(() => {
            void loadBoard({ sync: boardStore.boardSyncPending });
          });
        }
      }
    }
  })();
  _boardLoading = loading;
  setBoardStore("loading", true);
  return loading;
}
async function loadTasks() {
  try {
    const data = await apiJson("tasks");
    const tasks = sortedTasks(data);
    const seen = new Set(
      tasks.map((item) => item?.task?.requestID).filter(Boolean)
    );
    setBoardStore({
      tasks,
      pendingTasks: boardStore.pendingTasks.filter(
        (item) => !seen.has(item?.requestID)
      )
    });
  } catch (e) {
    console.error("loadTasks failed", e);
  }
}
function clearBoard() {
  clearBoardRetry$1();
  if (boardLoadTimer) {
    clearTimeout(boardLoadTimer);
    boardLoadTimer = null;
  }
  boardLoadDeadline = 0;
  _boardQueued = false;
  setBoardStore({
    board: null,
    taskSequence: 0,
    boardEtag: "",
    boardSyncPending: false,
    boardQueued: false,
    boardUpdatedAt: 0,
    snapshotVersion: "",
    path: null,
    vcs: null,
    changes: []
  });
}
let boardLoadTimer = null;
let boardLoadDeadline = 0;
const BOARD_MAX_DELAY_MS = 2e3;
function scheduleBoard(delay = 0) {
  setBoardSyncPending(true);
  clearBoardRetry$1();
  const now = Date.now();
  if (!boardLoadTimer || boardLoadDeadline === 0) {
    boardLoadDeadline = now + BOARD_MAX_DELAY_MS;
  }
  if (boardLoadTimer) {
    clearTimeout(boardLoadTimer);
    boardLoadTimer = null;
  }
  const remaining = Math.max(0, boardLoadDeadline - now);
  const effectiveDelay = Math.min(delay, remaining);
  boardLoadTimer = setTimeout(() => {
    boardLoadTimer = null;
    boardLoadDeadline = 0;
    void loadBoard({ sync: true });
  }, effectiveDelay);
}
function rootTaskSessionID() {
  const sessionID = boardStore.board?.task?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}
function activeDirectory$1() {
  return boardStore.board?.task?.directory ?? "";
}
function setPath(path) {
  setBoardStore("path", path ?? null);
}
function setVcs(vcs) {
  setBoardStore("vcs", vcs ?? null);
}
function setBoardEtag(etag) {
  setBoardStore("boardEtag", typeof etag === "string" ? etag : "");
}
function setBoardQueued(queued) {
  setBoardStore("boardQueued", queued);
}
function setBoardRetryCount(count) {
  setBoardStore("boardRetryCount", typeof count === "number" ? count : 0);
}
function setBoardSyncPending(pending) {
  setBoardStore("boardSyncPending", pending);
}
function setBoardUpdatedAt(ms) {
  setBoardStore("boardUpdatedAt", typeof ms === "number" ? ms : 0);
}
function setSnapshotVersion(version) {
  setBoardStore("snapshotVersion", typeof version === "string" ? version : "");
}
function setTaskSequence(sequence) {
  setBoardStore("taskSequence", typeof sequence === "number" ? sequence : 0);
}
function sortedTasks(data) {
  return [...Array.isArray(data?.tasks) ? data.tasks : []].sort(
    (a, b) => (b.updated_at || b.task?.time?.updated || 0) - (a.updated_at || a.task?.time?.updated || 0)
  );
}
function taskUpdated$1(item) {
  return item?.updated_at || item?.task?.time?.updated || item?.task?.time?.created || 0;
}
function visibleTasks() {
  const seen = new Set(
    boardStore.tasks.map((item) => item?.task?.requestID || item?.task?.id).filter(Boolean)
  );
  return [
    ...boardStore.pendingTasks.filter(
      (item) => !seen.has(item?.requestID || item?.task?.id)
    ),
    ...boardStore.tasks
  ].sort((a, b) => taskUpdated$1(b) - taskUpdated$1(a));
}
const INTERRUPTABLE_STATUSES = /* @__PURE__ */ new Set(["queued", "active"]);
function isTaskInterruptable() {
  const status = boardStore.board?.task?.status;
  return !!status && INTERRUPTABLE_STATUSES.has(status);
}

const board = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  activeDirectory: activeDirectory$1,
  boardStore,
  clearBoard,
  isTaskInterruptable,
  loadBoard,
  loadTasks,
  rootTaskSessionID,
  scheduleBoard,
  setBoardEtag,
  setBoardQueued,
  setBoardRetryCount,
  setBoardStore,
  setBoardSyncPending,
  setBoardUpdatedAt,
  setPath,
  setSnapshotVersion,
  setTaskSequence,
  setVcs,
  sortedTasks,
  taskUpdated: taskUpdated$1,
  visibleTasks
}, Symbol.toStringTag, { value: 'Module' }));

const [store$1, setStore$1] = createStore({
  expandedAgentCards: {},
  expandedToolOutputs: {}
});
function clearConversationUiState() {
  setStore$1("expandedAgentCards", reconcile({}, { merge: false }));
  setStore$1("expandedToolOutputs", reconcile({}, { merge: false }));
}
function agentCardExpanded(cardID, running) {
  if (!cardID) return false;
  const explicit = store$1.expandedAgentCards[cardID];
  if (explicit !== void 0 && explicit.running === (running === true)) {
    return explicit.value;
  }
  return true;
}
function toggleAgentCardExpanded(cardID, running) {
  if (!cardID) return;
  const next = !agentCardExpanded(cardID, running);
  setStore$1("expandedAgentCards", cardID, { value: next, running });
}
function toolOutputExpanded(partID) {
  if (!partID) return false;
  return store$1.expandedToolOutputs[partID] === true;
}
function toggleToolOutputExpanded(partID) {
  if (!partID) return;
  setStore$1("expandedToolOutputs", partID, (value) => value !== true);
}

var _tmpl$$u = /* @__PURE__ */ template(`<span class=tool-detail>`), _tmpl$2$s = /* @__PURE__ */ template(`<div class=msg-tool><span class=tool-icon></span><span class=tool-name></span><span class=tool-status>`), _tmpl$3$p = /* @__PURE__ */ template(`<div class=msg-tool-input>`), _tmpl$4$n = /* @__PURE__ */ template(`<div class="msg-tool-code md-content">`), _tmpl$5$k = /* @__PURE__ */ template(`<button class=msg-tool-expand>+<!> 行 · 展开全部`), _tmpl$6$f = /* @__PURE__ */ template(`<div class=msg-tool-output>`), _tmpl$7$d = /* @__PURE__ */ template(`<div class=msg-tool-error>`);
const FILE_WRITE_TOOLS = /* @__PURE__ */ new Set(["write", "writefile"]);
const FILE_EDIT_TOOLS = /* @__PURE__ */ new Set(["edit", "editfile", "applypatch"]);
const FILE_READ_TOOLS = /* @__PURE__ */ new Set(["read", "readfile"]);
function isFileContentTool(key) {
  return FILE_WRITE_TOOLS.has(key) || FILE_EDIT_TOOLS.has(key) || FILE_READ_TOOLS.has(key);
}
function extractFilePath(inp) {
  return inp?.file_path ?? inp?.filePath ?? inp?.path ?? inp?.filename ?? "";
}
function extractCodeContent(key, inp, out) {
  if (FILE_WRITE_TOOLS.has(key)) return inp?.content ?? inp?.text ?? "";
  if (FILE_EDIT_TOOLS.has(key)) {
    const oldStr = inp?.old_string ?? "";
    const newStr = inp?.new_string ?? "";
    if (oldStr && newStr) return `--- old
${oldStr}
--- new
${newStr}`;
    return newStr || (inp?.content ?? "");
  }
  if (FILE_READ_TOOLS.has(key)) return out;
  return "";
}
function ToolPart(props) {
  const state = () => props.part.state || {};
  const status = () => state().status || "pending";
  const toolName = () => props.part.tool || "unknown";
  const input = () => state().input || {};
  const icon = () => displayToolIcon(toolName());
  const statusLabel = () => toolStatusLabel(status());
  const detail = () => {
    const raw2 = displayToolDetail(toolName(), input(), state(), activeDirectory$1());
    return raw2 && raw2.toLowerCase() !== toolName().toLowerCase() ? raw2 : "";
  };
  const raw = () => {
    const st = state();
    const r = typeof st.raw === "string" ? typeof props.part._targetRaw === "string" ? props.part._targetRaw : st.raw : "";
    return r;
  };
  const output = () => stripAnsi(state().output || "");
  const error = () => stripAnsi(state().error || "") || output();
  const expanded = () => toolOutputExpanded(props.part?.id || "");
  const key = () => toolNameKey(toolName());
  const codeResult = createMemo(() => {
    if (status() !== "completed") return null;
    const k = key();
    if (!isFileContentTool(k)) return null;
    const content = extractCodeContent(k, input(), output());
    if (!content) return null;
    const lang = extToLang(extractFilePath(input()));
    return renderCodeBlock(content, lang, expanded() ? Infinity : 100);
  });
  return [(() => {
    var _el$ = _tmpl$2$s(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$5 = _el$3.nextSibling;
    insert(_el$2, icon);
    insert(_el$3, toolName);
    insert(_el$, createComponent(Show, {
      get when() {
        return detail();
      },
      get children() {
        var _el$4 = _tmpl$$u();
        insert(_el$4, detail);
        return _el$4;
      }
    }), _el$5);
    insert(_el$5, statusLabel);
    createRenderEffect((_p$) => {
      var _v$ = status(), _v$2 = statusLabel();
      _v$ !== _p$.e && setAttribute(_el$5, "data-status", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$5, "title", _p$.t = _v$2);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })(), createComponent(Show, {
    get when() {
      return memo(() => status() === "pending")() && raw();
    },
    get children() {
      var _el$6 = _tmpl$3$p();
      insert(_el$6, raw);
      return _el$6;
    }
  }), createComponent(Show, {
    get when() {
      return codeResult();
    },
    get children() {
      return [(() => {
        var _el$7 = _tmpl$4$n();
        createRenderEffect(() => _el$7.innerHTML = codeResult().html);
        return _el$7;
      })(), createComponent(Show, {
        get when() {
          return codeResult().truncated;
        },
        get children() {
          var _el$8 = _tmpl$5$k(), _el$9 = _el$8.firstChild, _el$1 = _el$9.nextSibling; _el$1.nextSibling;
          _el$8.$$click = () => toggleToolOutputExpanded(props.part?.id || "");
          insert(_el$8, () => codeResult().totalLines - 100, _el$1);
          return _el$8;
        }
      })];
    }
  }), createComponent(Show, {
    get when() {
      return memo(() => !!(status() === "completed" && output()))() && !codeResult();
    },
    get children() {
      var _el$10 = _tmpl$6$f();
      _el$10.$$click = () => toggleToolOutputExpanded(props.part?.id || "");
      insert(_el$10, output);
      createRenderEffect(() => _el$10.classList.toggle("msg-tool-output--expanded", !!expanded()));
      return _el$10;
    }
  }), createComponent(Show, {
    get when() {
      return memo(() => status() === "error")() && error();
    },
    get children() {
      var _el$11 = _tmpl$7$d();
      insert(_el$11, error);
      return _el$11;
    }
  })];
}
delegateEvents(["click"]);

const [reasoningRevision, setReasoningRevision] = createSignal(0);
function record$5(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function reasoningPartKey(part) {
  if (!record$5(part)) return "";
  const id = typeof part.id === "string" ? part.id : "";
  const messageID = typeof part.messageID === "string" ? part.messageID : "";
  const sessionID = typeof part.sessionID === "string" ? part.sessionID : "";
  if (!id && !messageID && !sessionID) return "";
  return `reasoning:${sessionID}:${messageID}:${id}`;
}
function reasoningPartHidden(_part) {
  return false;
}
function touchReasoningPart$1(part) {
  const key = reasoningPartKey(part);
  if (!key) return;
  setReasoningRevision((r) => r + 1);
}

var _tmpl$$t = /* @__PURE__ */ template(`<div class="reasoning-text md-content">`), _tmpl$2$r = /* @__PURE__ */ template(`<div class=msg-reasoning><div class=reasoning-label> `);
function isEmptyReasoning(s) {
  return !s.replace(/[\[\]\s]/g, "");
}
function ReasoningPart(props) {
  const [expanded, setExpanded] = createSignal(true);
  const text = () => String(props.part?.text || "");
  const hidden = createMemo(() => {
    reasoningRevision();
    return reasoningPartHidden(props.part);
  });
  const label = () => t("transcript.reasoning");
  return createComponent(Show, {
    get when() {
      return memo(() => !!(text().trim() && !isEmptyReasoning(text())))() && !hidden();
    },
    get children() {
      var _el$ = _tmpl$2$r(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild;
      _el$2.$$click = () => setExpanded(!expanded());
      insert(_el$2, label, _el$3);
      insert(_el$2, () => expanded() ? "▼" : "▶", null);
      insert(_el$, createComponent(Show, {
        get when() {
          return expanded();
        },
        get children() {
          var _el$4 = _tmpl$$t();
          createRenderEffect(() => _el$4.innerHTML = renderMarkdown(text()));
          return _el$4;
        }
      }), null);
      return _el$;
    }
  });
}
delegateEvents(["click"]);

const AGENT_CARD_STAGES = /* @__PURE__ */ new Set(["assistant", "spec", "architect", "planner", "goal", "executor", "evaluator", "delivery"]);
function normalizeAgentRole(name) {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return "assistant";
  if (text === "user") return "user";
  if (text === "orchestrator" || text === "task_agent") return "assistant";
  if (text === "spec") return "spec";
  if (text === "architect" || text === "architecture" || text === "coordination") return "architect";
  if (text === "planner" || text === "plan" || text === "planning" || text === "replan") return "planner";
  if (text === "goal" || text === "goal_gate") return "goal";
  if (text === "executor" || text === "build" || text === "coding" || text === "general" || text === "explore" || text === "execute" || text === "opencode" || text === "codex" || text === "claude-code") return "executor";
  if (text === "judge" || text === "evaluator" || text === "evaluation" || text === "eval" || text === "scheduler" || text === "review" || text === "evaluate") return "evaluator";
  if (text === "delivery" || text === "deliver" || text === "files" || text === "publish") return "delivery";
  if (text === "system" || text === "compaction" || text === "title" || text === "summary") return "system";
  return "assistant";
}
function agentRoleToSectionPhase(role) {
  if (role === "spec") return "spec";
  if (role === "architect") return "architect";
  if (role === "planner") return "plan";
  if (role === "goal") return "goals";
  if (role === "executor") return "executor";
  if (role === "evaluator") return "evaluation";
  if (role === "delivery") return "files";
  return "";
}
function orderedMessageParts(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  if (parts.length < 2) return parts;
  const reasoning = [];
  const rest = [];
  for (const part of parts) {
    if (part?.type === "reasoning") reasoning.push(part);
    else rest.push(part);
  }
  return [...reasoning, ...rest];
}
function roleLabel(role) {
  if (role === "user") return t("chat.role.user");
  if (role === "assistant") return t("chat.role.assistant");
  if (role === "architect") return t("chat.role.architect");
  if (role === "planner") return t("chat.role.planner");
  if (role === "evaluator") return t("chat.role.evaluator");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "spec") return t("chat.role.spec");
  if (role === "system") return t("chat.role.system");
  if (role === "goal" || role === "goal_gate") return t("chat.role.goal");
  if (role === "executor") return t("chat.role.executor");
  return t("chat.role.assistant");
}
function classifyMessage(msg, rootSessionID) {
  const backendChannel = String(msg?.info?.channel || "").trim().toLowerCase();
  if (backendChannel && backendChannel !== "main") {
    if (backendChannel === "filtered") return "filtered";
    const resolved2 = String(msg?.info?.resolvedRole || "").trim().toLowerCase();
    if (AGENT_CARD_STAGES.has(resolved2)) return resolved2;
  }
  if (String(msg?.info?.role || "").trim().toLowerCase() === "user") return "main";
  const resolved = String(msg?.info?.resolvedRole || "").trim().toLowerCase();
  if (AGENT_CARD_STAGES.has(resolved)) return resolved;
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  const normalized = normalizeAgentRole(agent);
  if (AGENT_CARD_STAGES.has(normalized)) return normalized;
  return "main";
}
function agentStageLabel(stage) {
  const role = normalizeAgentRole(stage);
  if (role === "spec") return t("chat.role.spec");
  if (role === "architect") return t("chat.role.architect");
  if (role === "planner") return t("chat.role.planner");
  if (role === "goal") return t("chat.role.goal");
  if (role === "evaluator") return t("chat.role.evaluator");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "executor") return t("chat.role.executor");
  return t("chat.role.assistant");
}
function effectiveRole(msg, _rootSessionID) {
  const resolved = msg.info?.resolvedRole;
  if (resolved) return resolved;
  const agent = String(msg.info?.agent || "").trim().toLowerCase();
  if (agent) {
    const normalized = normalizeAgentRole(agent);
    if (AGENT_CARD_STAGES.has(normalized)) return normalized;
  }
  return msg.info?.role || "assistant";
}

function timeLocaleOptions(includeSeconds = true) {
  return includeSeconds ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" };
}
function stamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(localeTag(), timeLocaleOptions());
}
function formatDuration(ms) {
  const s = Math.floor(ms / 1e3);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return t("time.duration.hour_minute", { hours: h, minutes: m % 60 });
  if (m > 0) return t("time.duration.minute_second", { minutes: m, seconds: s % 60 });
  return t("time.duration.second", { seconds: s });
}

var _tmpl$$s = /* @__PURE__ */ template(`<article class="turn msg"><div class=msg-head><span class=msg-role></span><span class=msg-time></span></div><div class=msg-bubble><div class=msg-body>`), _tmpl$2$q = /* @__PURE__ */ template(`<div class=msg-patch>`), _tmpl$3$o = /* @__PURE__ */ template(`<div>`), _tmpl$4$m = /* @__PURE__ */ template(`<div class=msg-tool><span class=tool-icon>→</span><span class=tool-name>Subtask</span><span class=tool-detail>`);
function renderFilePart(part) {
  const url = part.url || part.filename || "";
  const name = part.filename || url || "file";
  const mime = part.mime || part.mediaType || "";
  const isImg = mime && mime.startsWith("image/") || /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
  if (isImg && url) {
    return `<div class="msg-img-wrap"><img class="md-img" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
  }
  return `<div class="msg-text" style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-soft)">${escapeHtml(name)}</div>`;
}
function MessageView(props) {
  const role = () => props.message.info?.resolvedRole || effectiveRole(props.message, rootTaskSessionID());
  const parts = () => orderedMessageParts(props.message);
  const time = () => stamp(props.message.info?.time?.created);
  const hasContent = createMemo(() => {
    const p = parts();
    if (p.length === 0) return false;
    return p.some((part) => {
      if (part.type === "text") return !!(part.text || "").trim();
      if (part.type === "tool") return true;
      if (part.type === "reasoning") return !!(part.text || "").trim() && !isEmptyReasoning(part.text || "");
      if (part.type === "patch") return (part.files || []).length > 0;
      if (part.type === "file") return true;
      if (part.type === "subtask") return true;
      return false;
    });
  });
  return createComponent(Show, {
    get when() {
      return hasContent();
    },
    get children() {
      var _el$ = _tmpl$$s(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$2.nextSibling, _el$6 = _el$5.firstChild;
      insert(_el$3, () => roleLabel(role()));
      insert(_el$4, time);
      insert(_el$6, createComponent(Index, {
        get each() {
          return parts();
        },
        children: (part) => createComponent(Switch, {
          fallback: null,
          get children() {
            return [createComponent(Match, {
              get when() {
                return memo(() => part().type === "text")() && (part().text || "").trim();
              },
              get children() {
                return createComponent(TextPart, {
                  get text() {
                    return part().text || "";
                  }
                });
              }
            }), createComponent(Match, {
              get when() {
                return part().type === "tool";
              },
              get children() {
                return createComponent(ToolPart, {
                  get part() {
                    return part();
                  }
                });
              }
            }), createComponent(Match, {
              get when() {
                return memo(() => !!(part().type === "reasoning" && (part().text || "").trim()))() && !isEmptyReasoning(part().text || "");
              },
              get children() {
                return createComponent(ReasoningPart, {
                  get part() {
                    return part();
                  }
                });
              }
            }), createComponent(Match, {
              get when() {
                return memo(() => part().type === "patch")() && (part().files || []).length > 0;
              },
              get children() {
                var _el$7 = _tmpl$2$q();
                insert(_el$7, () => "⚙ " + (part().files || []).map((f) => shortRelativePath(f, activeDirectory$1())).join(", "));
                return _el$7;
              }
            }), createComponent(Match, {
              get when() {
                return part().type === "file";
              },
              get children() {
                var _el$8 = _tmpl$3$o();
                createRenderEffect(() => _el$8.innerHTML = renderFilePart(part()));
                return _el$8;
              }
            }), createComponent(Match, {
              get when() {
                return part().type === "subtask";
              },
              get children() {
                var _el$9 = _tmpl$4$m(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling;
                insert(_el$10, () => part().description || part().prompt || "");
                return _el$9;
              }
            })];
          }
        })
      }));
      createRenderEffect(() => setAttribute(_el$, "data-role", role()));
      return _el$;
    }
  });
}

const scriptRel = 'modulepreload';const assetsURL = function(dep) { return "/"+dep };const seen = {};const __vitePreload = function preload(baseModule, deps, importerUrl) {
  let promise = Promise.resolve();
  if (true               && deps && deps.length > 0) {
    let allSettled2 = function(promises) {
      return Promise.all(promises.map((p) => Promise.resolve(p).then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }))));
    };
    document.getElementsByTagName("link"); const cspNonceMeta = document.querySelector("meta[property=csp-nonce]"), cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
    promise = allSettled2(deps.map((dep) => {
      dep = assetsURL(dep);
      if (dep in seen)
        return;
      seen[dep] = true;
      const isCss = dep.endsWith(".css"), cssSelector = isCss ? '[rel="stylesheet"]' : "";
      if (document.querySelector(`link[href="${dep}"]${cssSelector}`))
        return;
      const link = document.createElement("link");
      link.rel = isCss ? "stylesheet" : scriptRel;
      if (!isCss)
        link.as = "script";
      link.crossOrigin = "";
      link.href = dep;
      if (cspNonce)
        link.setAttribute("nonce", cspNonce);
      document.head.appendChild(link);
      if (isCss)
        return new Promise((res, rej) => {
          link.addEventListener("load", res);
          link.addEventListener("error", () => rej(Error(`Unable to preload CSS for ${dep}`)));
        });
    }));
  }
  function handlePreloadError(err) {
    const e = new Event("vite:preloadError", {
      cancelable: true
    });
    e.payload = err;
    window.dispatchEvent(e);
    if (!e.defaultPrevented)
      throw err;
  }
  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== "rejected")
        continue;
      handlePreloadError(item.reason);
    }
    return baseModule().catch(handlePreloadError);
  });
};

function getDomRefs() {
  const $ = (sel) => document.querySelector(sel);
  return {
    // Canvas / branding
    techAtlasCanvas: $("#techAtlasCanvas"),
    titlebar: $("#titlebar"),
    connBadge: $("#connBadge"),
    brandLogo: $(".brand-logo"),
    brandVersion: $("#brandVersion"),
    chatVersion: $("#chatVersion"),
    chatAuthor: $("#chatAuthor"),
    // Titlebar controls
    btnTitlebarMenu: $("#btnTitlebarMenu"),
    titlebarMenu: $("#titlebarMenu"),
    btnLocale: $("#btnLocale"),
    btnLocaleLabel: $("#btnLocaleLabel"),
    btnTheme: $("#btnTheme"),
    btnThemeValue: $("#btnThemeValue"),
    btnSettings: $("#btnSettings"),
    btnPin: $("#btnPin"),
    btnPinValue: $("#btnPinValue"),
    // Settings checkboxes / controls
    chkUnattended: $("#chkUnattended"),
    chkAutoPermission: $("#chkAutoPermission"),
    chkAutoQuestion: $("#chkAutoQuestion"),
    chkShowTranscriptDetails: $("#chkShowTranscriptDetails"),
    opacityRange: $("#opacityRange"),
    opacityValue: $("#opacityValue"),
    // Window controls
    btnMinimize: $("#btnMinimize"),
    btnMaximize: $("#btnMaximize"),
    btnClose: $("#btnClose"),
    // Layout panels
    panelBody: $("#panelBody"),
    sidebar: $("#sidebar"),
    btnSidebarToggle: $("#btnSidebarToggle"),
    leftPaneResizer: $("#leftPaneResizer"),
    workspaceMain: $("#workspaceMain"),
    rightPaneResizer: $("#rightPaneResizer"),
    sections: $("#sections"),
    // Task / workspace
    taskDir: $("#taskDir"),
    recentDirPanel: $("#recentDirPanel"),
    taskWorkspaceDir: $("#taskWorkspaceDir"),
    taskGit: $("#taskGit"),
    btnBrowseCwd: $("#btnBrowseCwd"),
    btnCreateCwd: $("#btnCreateCwd"),
    btnOpenCwd: $("#btnOpenCwd"),
    btnResetCwd: $("#btnResetCwd"),
    // Engine / model panels
    engineBar: $("#engineBar"),
    codexModelPanel: $("#codexModelPanel"),
    claudeCodeModelPanel: $("#claudeCodeModelPanel"),
    // Task meta
    taskStatus: $("#taskStatus"),
    extensionsBadge: $("#extensionsBadge"),
    // Config dialog
    btnConfigToggle: $("#btnConfigToggle"),
    configToggleMeta: $("#configToggleMeta"),
    configDialog: $("#configDialog"),
    btnCloseConfigDialog: $("#btnCloseConfigDialog"),
    // Prompt section
    promptSection: $("#promptSection"),
    promptBody: $("#promptBody"),
    promptBadge: $("#promptBadge"),
    taskActionsBar: $("#taskActionsBar"),
    // PRD sections
    specSection: $("#specSection"),
    planSection: $("#planSection"),
    goalsSection: $("#goalsSection"),
    executorSection: $("#executorSection"),
    criteriaSection: $("#criteriaSection"),
    deliverySection: $("#deliverySection"),
    deliveryBadge: $("#deliveryBadge"),
    deliveryBody: $("#deliveryBody"),
    changesSection: $("#changesSection"),
    // Channel section
    channelSection: $("#channelSection"),
    channelConfigBody: $("#channelConfigBody"),
    channelPublicUrl: $("#channelPublicUrl"),
    btnSaveChannelPublicUrl: $("#btnSaveChannelPublicUrl"),
    cfgAvailableProviders: $("#cfgAvailableProviders"),
    // Lists
    channelList: $("#channelList"),
    skillList: $("#skillList"),
    btnSkillMarket: $("#btnSkillMarket"),
    btnOpenSkillRoot: $("#btnOpenSkillRoot"),
    btnReloadSkills: $("#btnReloadSkills"),
    btnDeleteAllSkills: $("#btnDeleteAllSkills"),
    mcpList: $("#mcpList"),
    btnAddSkill: $("#btnAddSkill"),
    btnAddMcp: $("#btnAddMcp"),
    btnDeleteAllMcp: $("#btnDeleteAllMcp"),
    // Status bar
    statusDot: $("#statusIcon"),
    statusLabel: $("#statusLabel"),
    taskElapsed: $("#taskElapsed"),
    // Spec / plan badges and bodies
    specBadge: $("#specBadge"),
    specBody: $("#specBody"),
    planBadge: $("#planBadge"),
    planBody: $("#planBody"),
    // Goals
    goalsBadge: $("#goalsBadge"),
    goalsBody: $("#goalsBody"),
    // Criteria / eval
    criteriaBadge: $("#criteriaBadge"),
    criteriaList: $("#criteriaList"),
    evalBody: $("#evalBody"),
    // Budget
    budgetConfigBody: $("#budgetConfigBody"),
    budgetHint: $("#budgetHint"),
    budgetMaxRuns: $("#budgetMaxRuns"),
    budgetMaxReplans: $("#budgetMaxReplans"),
    btnBudgetReset: $("#btnBudgetReset"),
    btnBudgetSave: $("#btnBudgetSave"),
    // Changes
    changesBadge: $("#changesBadge"),
    changesBody: $("#changesBody"),
    // Chat
    chatGoalsStrip: $("#chatGoalsStrip"),
    chatScroll: $("#chatScroll"),
    chatEmpty: $("#chatEmpty"),
    chatCount: $("#chatCount"),
    btnChatCopyAll: $("#btnChatCopyAll"),
    btnWorkspaceToggle: $("#btnWorkspaceToggle"),
    // Chat form
    chatForm: $("#chatForm"),
    chatTextarea: $("#chatTextarea"),
    chatAttachments: $("#chatAttachments"),
    chatFileInput: $("#chatFileInput"),
    btnChatAttach: $("#btnChatAttach"),
    btnTaskInterrupt: $("#btnTaskInterrupt"),
    chatSend: $("#chatSend"),
    // Task list panel
    taskListPanel: $("#taskListPanel"),
    btnRefreshTasks: $("#btnRefreshTasks"),
    btnCreateTask: $("#btnCreateTask"),
    // Skill dialog
    skillDialog: $("#skillDialog"),
    skillForm: $("#skillForm"),
    skillType: $("#skillType"),
    skillValue: $("#skillValue"),
    skillPolicy: $("#skillPolicy"),
    btnPickSkillPath: $("#btnPickSkillPath"),
    btnCancelSkill: $("#btnCancelSkill"),
    // Skill market dialog
    skillMarketDialog: $("#skillMarketDialog"),
    skillMarketList: $("#skillMarketList"),
    btnCloseSkillMarket: $("#btnCloseSkillMarket"),
    // MCP dialog
    mcpDialog: $("#mcpDialog"),
    mcpForm: $("#mcpForm"),
    mcpName: $("#mcpName"),
    mcpType: $("#mcpType"),
    mcpUrl: $("#mcpUrl"),
    mcpCommand: $("#mcpCommand"),
    mcpArgs: $("#mcpArgs"),
    mcpRemoteField: $("#mcpRemoteField"),
    mcpCommandField: $("#mcpCommandField"),
    mcpArgsField: $("#mcpArgsField"),
    btnCancelMcp: $("#btnCancelMcp"),
    // Goal dialog
    goalDialog: $("#goalDialog"),
    goalForm: $("#goalForm"),
    goalDialogTitle: $("#goalDialogTitle"),
    goalId: $("#goalId"),
    goalDescription: $("#goalDescription"),
    goalCriteria: $("#goalCriteria"),
    btnCancelGoal: $("#btnCancelGoal"),
    // Diff dialog
    diffDialog: $("#diffDialog"),
    diffDialogTitle: $("#diffDialogTitle"),
    diffDialogMeta: $("#diffDialogMeta"),
    diffDialogBody: $("#diffDialogBody"),
    btnCloseDiff: $("#btnCloseDiff"),
    // Generic app dialog
    appDialog: $("#appDialog"),
    appDialogTitle: $("#appDialogTitle"),
    appDialogBody: $("#appDialogBody"),
    appDialogInputField: $("#appDialogInputField"),
    appDialogInputLabel: $("#appDialogInputLabel"),
    appDialogInput: $("#appDialogInput"),
    appDialogSelectField: $("#appDialogSelectField"),
    appDialogSelectLabel: $("#appDialogSelectLabel"),
    appDialogSelect: $("#appDialogSelect"),
    btnAppDialogCancel: $("#btnAppDialogCancel"),
    btnAppDialogOk: $("#btnAppDialogOk"),
    // LLM form
    llmForm: $("#llmForm"),
    llmSection: $("#llmSection"),
    llmAdvanced: $("#llmAdvanced"),
    llmSummary: $("#llmSummary"),
    llmProvider: $("#llmProvider"),
    llmModel: $("#llmModel"),
    llmApiKey: $("#llmApiKey"),
    llmApiKeySummary: $("#llmApiKeySummary"),
    btnLlmApiKeyToggle: $("#btnLlmApiKeyToggle"),
    btnLlmApiKeyCopy: $("#btnLlmApiKeyCopy"),
    btnLlmAuthAction: $("#btnLlmAuthAction"),
    llmStatus: $("#llmStatus"),
    llmNotice: $("#llmNotice"),
    // Channel dialog
    channelDialog: $("#channelDialog"),
    channelForm: $("#channelForm"),
    channelDialogTitle: $("#channelDialogTitle"),
    channelId: $("#channelId"),
    channelFields: $("#channelFields"),
    btnCancelChannel: $("#btnCancelChannel"),
    // Settings dialog
    settingsDialog: $("#settingsDialog"),
    settingsForm: $("#settingsForm"),
    serverUrl: $("#serverUrl"),
    serverPassword: $("#serverPassword"),
    serverUsername: $("#serverUsername"),
    localeMode: $("#localeMode"),
    themeMode: $("#themeMode"),
    // Knowledge: Memory
    memoryBadge: $("#memoryBadge"),
    memoryList: $("#memoryList"),
    memorySearch: $("#memorySearch"),
    btnMemorySearch: $("#btnMemorySearch"),
    btnMemoryRefresh: $("#btnMemoryRefresh"),
    memoryDialog: $("#memoryDialog"),
    memoryDialogTitle: $("#memoryDialogTitle"),
    memoryDialogMeta: $("#memoryDialogMeta"),
    memoryDialogContent: $("#memoryDialogContent"),
    btnDeleteMemory: $("#btnDeleteMemory"),
    btnCloseMemory: $("#btnCloseMemory"),
    // Log viewer
    logDialog: $("#logDialog"),
    logViewerBody: $("#logViewerBody"),
    logLevelFilter: $("#logLevelFilter"),
    btnLog: $("#btnLog"),
    btnLogRefresh: $("#btnLogRefresh"),
    btnLogCopy: $("#btnLogCopy"),
    btnLogClear: $("#btnLogClear"),
    btnCloseLog: $("#btnCloseLog"),
    btnLogServerLogs: $("#btnLogServerLogs")
  };
}

function phaseSections() {
  const dom = getDomRefs();
  return {
    spec: dom.specSection,
    plan: dom.planSection,
    goals: dom.goalsSection,
    executor: dom.executorSection,
    evaluation: dom.criteriaSection,
    delivery: dom.deliverySection,
    files: dom.changesSection
  };
}
function markSectionPhase(kind, value) {
  const node = phaseSections()[kind];
  if (!node) return;
  if (!value) {
    delete node.dataset.phaseState;
    return;
  }
  node.dataset.phaseState = value;
}
function liveConversationPhase(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const running = parts.some(
      (part) => part?.type === "tool" && ["running", "pending"].includes(part?.state?.status || "")
    );
    const incomplete = message?.info?.role === "assistant" && !message?.info?.time?.completed;
    if (!running && !incomplete) continue;
    const agent = String(message?.info?.agent || "").trim().toLowerCase();
    const phase = agentRoleToSectionPhase(normalizeAgentRole(agent));
    if (phase) return phase;
  }
  return "";
}
function relatePhase(kind, related, board, goals, changesCount) {
  if (!kind) return;
  if (kind === "plan") {
    if (board?.spec) related.push("spec");
    return;
  }
  if (kind === "goals") {
    if (board?.plan) related.push("plan");
    if (changesCount > 0) related.push("files");
    return;
  }
  if (kind === "evaluation") {
    if (goals.length > 0) related.push("goals");
    if (changesCount > 0) related.push("files");
    return;
  }
  if (kind === "files") {
    if (board?.evaluation) related.push("evaluation");
    if (goals.length > 0) related.push("goals");
    return;
  }
}
function clearSectionPhases() {
  Object.values(phaseSections()).forEach((node) => {
    if (!node) return;
    delete node.dataset.phaseState;
  });
}
function syncSectionPhases(board, changesCount = 0) {
  clearSectionPhases();
  const messages = Array.isArray(store.messages) ? store.messages : [];
  const live = liveConversationPhase(messages);
  if (!board?.task && !live) return;
  const goals = (board?.lanes || []).find((lane) => lane.id === "goals")?.cards || [];
  const pending = (board?.interactions || []).some((item) => item.status === "pending");
  const taskStatus = board?.task?.status || "";
  const planning = board?.task ? board.run?.phase === "plan" || board.run?.phase === "replan" : false;
  const active = [];
  const related = [];
  if (live) {
    active.push(live);
    relatePhase(live, related, board, goals, changesCount);
  }
  if (board?.task && pending) {
    active.length = 0;
    if (board.plan) active.push("plan");
    else if (goals.length > 0) active.push("goals");
    else if (board.spec) active.push("spec");
  }
  if (board?.task && active.length === 0 && taskStatus === "queued") {
    if (board.spec) active.push("spec");
    else if (board.plan) active.push("plan");
  }
  if (board?.task && active.length === 0 && planning) {
    active.push(board.spec ? "plan" : "spec");
    if (board.spec) related.push("spec");
    if (board.plan) related.push("plan");
  }
  if (board?.task && active.length === 0 && taskStatus === "active") {
    if (board.evaluation) {
      active.push("evaluation");
      if (goals.length > 0) related.push("goals");
      if (changesCount > 0) related.push("files");
    } else if (board.delivery) {
      active.push("delivery");
      if (changesCount > 0) related.push("files");
      if (goals.length > 0) related.push("goals");
    } else if (goals.length > 0) {
      active.push("executor");
      related.push("goals");
      if (board.plan) related.push("plan");
      if (changesCount > 0) related.push("files");
    } else if (board.plan) {
      active.push("plan");
      if (board.spec) related.push("spec");
    } else {
      active.push("spec");
    }
  }
  if (board?.task && active.length === 0 && board.task.status === "completed") {
    active.push(
      board.delivery ? "delivery" : changesCount > 0 ? "files" : "evaluation"
    );
    if (board.delivery && changesCount > 0) related.push("files");
    if (board.evaluation) related.push("evaluation");
    if (goals.length > 0) related.push("goals");
  }
  if (board?.task && active.length === 0 && board.task.status === "failed") {
    active.push(board.evaluation ? "evaluation" : board.plan ? "plan" : "spec");
    if (board.plan) related.push("plan");
    if (goals.length > 0) related.push("goals");
  }
  if (board?.task && active.length === 0 && board.task.status === "cancelled") {
    if (board.plan) active.push("plan");
    else if (board.spec) active.push("spec");
  }
  const current = [...new Set(active.filter(Boolean))];
  const contextual = [
    ...new Set(related.filter((kind) => kind && !current.includes(kind)))
  ];
  current.forEach((kind) => markSectionPhase(kind, "active"));
  contextual.forEach((kind) => markSectionPhase(kind, "related"));
}

const [store, setStore] = createStore({
  messages: [],
  agentEvents: [],
  selectedTaskID: "",
  showTranscriptDetails: false,
  agentStatus: null,
  sseConnected: false,
  /** @deprecated No longer used — kept only for store shape compatibility. */
  conversationUpdatedAt: 0,
  // ── Chat request / attachments (mirrors state.chatRequest / state.chatAttachments) ──
  /** AbortController for the active chat HTTP request; null when idle */
  chatRequest: null,
  /** File attachments staged for the next chat message */
  chatAttachments: []
});
const messageIndex = /* @__PURE__ */ new Map();
const _pendingParts = /* @__PURE__ */ new Map();
const PENDING_PARTS_TTL_MS = 6e4;
let _lastPendingPrune = 0;
function prunePendingParts() {
  const now = Date.now();
  if (now - _lastPendingPrune < 1e4) return;
  _lastPendingPrune = now;
  for (const [key, entry] of _pendingParts) {
    if (now - entry.created > PENDING_PARTS_TTL_MS) {
      _pendingParts.delete(key);
    }
  }
}
function rebuildMessageIndex() {
  messageIndex.clear();
  for (const msg of store.messages) {
    if (msg?.info?.id) messageIndex.set(msg.info.id, msg);
  }
}
function messageById(id) {
  return messageIndex.get(id);
}
const UNTIMED_MESSAGE_ORDER = Number.MAX_SAFE_INTEGER;
function finiteMessageTime(item) {
  const created = item?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = item?.info?.time?.updated;
  if (Number.isFinite(updated)) return Number(updated);
  return void 0;
}
function messageOrderTime(item) {
  return finiteMessageTime(item) ?? UNTIMED_MESSAGE_ORDER;
}
function messageTime(item) {
  return finiteMessageTime(item) ?? 0;
}
function sortMessages(list) {
  const result = list.slice();
  result.sort((a, b) => messageOrderTime(a) - messageOrderTime(b));
  return result;
}
function insertSorted(msgs, msg) {
  const t = messageOrderTime(msg);
  if (msgs.length === 0 || messageOrderTime(msgs[msgs.length - 1]) <= t) {
    msgs.push(msg);
    return msgs.length - 1;
  }
  let lo = 0, hi = msgs.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (messageOrderTime(msgs[mid]) <= t) lo = mid + 1;
    else hi = mid;
  }
  msgs.splice(lo, 0, msg);
  return lo;
}
function mergeMessageInfo(existing, next) {
  const existingTime = existing?.time;
  const nextTime = next?.time;
  const createdCandidates = [existingTime?.created, nextTime?.created].filter((value) => Number.isFinite(value));
  const updatedCandidates = [existingTime?.updated, nextTime?.updated].filter((value) => Number.isFinite(value));
  const completedCandidates = [existingTime?.completed, nextTime?.completed].filter((value) => Number.isFinite(value));
  const time = {};
  if (createdCandidates.length > 0) time.created = Math.min(...createdCandidates);
  if (updatedCandidates.length > 0) time.updated = Math.max(...updatedCandidates);
  if (completedCandidates.length > 0) time.completed = Math.max(...completedCandidates);
  return {
    ...existing || {},
    ...next,
    time
  };
}
function record$4(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function stableStringify(value) {
  if (value == null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (!record$4(value)) return JSON.stringify(String(value));
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
function hashText$1(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function partSignature(part) {
  return stableStringify({
    type: part?.type || "",
    text: part?.text || "",
    tool: part?.tool || "",
    kind: part?.kind || "",
    source: part?.source || "",
    filename: part?.filename || "",
    url: part?.url || "",
    mime: part?.mime || part?.mediaType || "",
    callID: part?.callID || "",
    description: part?.description || "",
    prompt: part?.prompt || "",
    audience: record$4(part?.audience) ? part.audience : null,
    state: record$4(part?.state) ? part.state : part?.state ?? null,
    files: Array.isArray(part?.files) ? part.files : [],
    process: record$4(part?.process) ? part.process : null
  });
}
function messageSignature(message) {
  const info = record$4(message?.info) ? message.info : {};
  return stableStringify({
    role: info.role || "",
    agent: info.agent || "",
    sessionID: info.sessionID || "",
    taskID: info.taskID || "",
    time: {
      created: info.time?.created || 0,
      updated: info.time?.updated || 0,
      completed: info.time?.completed || 0
    },
    parts: Array.isArray(message?.parts) ? message.parts.map((part) => partSignature(part)) : []
  });
}
function normalizeLoadedPart(input, messageID, sessionID, index) {
  const part = record$4(input) ? { ...input } : { type: "text", text: String(input || "") };
  const id = typeof part.id === "string" && part.id.trim() ? part.id.trim() : `loaded-part:${messageID}:${index}:${hashText$1(partSignature(part))}`;
  return {
    ...part,
    id,
    messageID: typeof part.messageID === "string" && part.messageID.trim() ? part.messageID.trim() : messageID,
    sessionID: typeof part.sessionID === "string" && part.sessionID.trim() ? part.sessionID.trim() : sessionID
  };
}
function normalizeLoadedMessage(input) {
  const message = record$4(input) ? input : {};
  const info = record$4(message.info) ? message.info : {};
  const signature = messageSignature(message);
  const id = typeof info.id === "string" && info.id.trim() ? info.id.trim() : `loaded-msg:${hashText$1(signature)}`;
  const sessionID = typeof info.sessionID === "string" && info.sessionID.trim() ? info.sessionID.trim() : "";
  const parts = Array.isArray(message.parts) ? message.parts.map(
    (part, index) => normalizeLoadedPart(part, id, sessionID, index)
  ) : [];
  return {
    ...message,
    info: {
      ...info,
      id,
      sessionID,
      role: typeof info.role === "string" && info.role.trim() ? info.role.trim() : "assistant"
    },
    parts
  };
}
function normalizeLoadedMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map(
    (message) => normalizeLoadedMessage(message)
  );
}
function mergeLoadedConversationMessages(left, right) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const item of [
    ...Array.isArray(left) ? left : [],
    ...Array.isArray(right) ? right : []
  ]) {
    const info = record$4(item?.info) ? item.info : {};
    const key = typeof info.id === "string" && info.id.trim() ? `id:${info.id.trim()}` : `sig:${messageSignature(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return normalizeLoadedMessages(result);
}
function activeAgentStages() {
  const status = String(boardStore.board?.task?.status || "").trim().toLowerCase();
  if (status !== "active") return /* @__PURE__ */ new Set();
  const stages = /* @__PURE__ */ new Set();
  for (const msg of store.messages) {
    const role = normalizeAgentRole(String(msg?.info?.resolvedRole || msg?.info?.channel || ""));
    if (!AGENT_CARD_STAGES.has(role)) continue;
    const hasRunning = (msg.parts || []).some((p) => p?.state?.status === "running");
    if (hasRunning) stages.add(role);
  }
  return stages;
}
function messageEndTime(message) {
  return Number(
    message?.info?.time?.completed || message?.info?.time?.updated || messageTime(message)
  );
}
function agentEventTime(event) {
  return Number(event?.time?.created || event?.timestamp || 0);
}
function agentEventDisplayText(event) {
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (live) return live;
  const target = typeof event?._targetText === "string" ? event._targetText : "";
  if (target) return target;
  if (typeof event?.text === "string" && event.text) return event.text;
  if (typeof event?.summary === "string" && event.summary) return event.summary;
  return "";
}
function agentEventToolName(event) {
  if (typeof event?.toolName === "string" && event.toolName.trim()) return event.toolName.trim();
  const summary = String(event?.summary || "");
  const split = summary.split("→");
  return split.length > 1 ? String(split[split.length - 1] || "").trim() : "";
}
function agentEventToolPart(event) {
  const tool = agentEventToolName(event);
  if (!tool) return null;
  const created = agentEventTime(event) || Date.now();
  const id = typeof event?.id === "string" && event.id ? event.id : `tool:${tool}:${created}`;
  const kind = String(event?.kind || "").trim().toLowerCase();
  const status = kind === "tool_result" ? "completed" : kind === "error" ? "error" : "running";
  const summary = agentEventDisplayText(event).trim() || tool;
  return {
    id: `agent-tool:${id}`,
    type: "tool",
    callID: id,
    tool,
    state: {
      status,
      input: {},
      ...status === "completed" ? { output: summary, title: tool } : {},
      ...status === "error" ? { error: summary } : {},
      ...status === "running" ? {
        title: summary,
        metadata: { synthetic: true },
        time: { start: created }
      } : {}
    }
  };
}
const _agentMsgCache = /* @__PURE__ */ new Map();
function agentMessageStableKey(event) {
  if (!event || typeof event !== "object") return "";
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return "";
  const created = agentEventTime(event) || 0;
  const eventID = typeof event?.id === "string" && event.id ? event.id : `${stage}:${String(event?.kind || "status")}:${created}`;
  const kind = String(event?.kind || "status").trim().toLowerCase();
  return `agent-event:${stage}:${eventID}:${kind}`;
}
function agentMessage(event) {
  if (!event || typeof event !== "object") return null;
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return null;
  const stableTime = agentEventTime(event) || 0;
  const created = stableTime || Date.now();
  const eventID = typeof event?.id === "string" && event.id ? event.id : `${stage}:${String(event?.kind || "status")}:${stableTime}`;
  const kind = String(event?.kind || "status").trim().toLowerCase();
  const text = agentEventDisplayText(event).trim();
  const msgID = `agent-event:${stage}:${eventID}`;
  const stableKey = `${msgID}:${kind}`;
  const cached = _agentMsgCache.get(stableKey);
  if (cached) {
    if (cached._sourceText === text) return cached.msg;
  }
  const resolvedRole = normalizeAgentRole(stage);
  const base = {
    _synthetic: true,
    info: {
      id: msgID,
      role: "assistant",
      resolvedRole,
      agent: stage,
      time: { created }
    },
    parts: []
  };
  let msg = null;
  if (kind === "reasoning_delta" && text) {
    msg = {
      ...base,
      parts: [
        {
          id: `reasoning:${eventID}`,
          type: "reasoning",
          text,
          _targetText: typeof event?._targetText === "string" ? event._targetText : text
        }
      ]
    };
  } else if (kind === "tool_call" || kind === "tool_delta" || kind === "tool_result") {
    const part = agentEventToolPart(event);
    msg = part ? { ...base, parts: [part] } : null;
  } else if (text) {
    msg = {
      ...base,
      parts: [
        {
          id: `text:${eventID}`,
          type: "text",
          text,
          _targetText: typeof event?._targetText === "string" ? event._targetText : text
        }
      ]
    };
  }
  if (msg) _agentMsgCache.set(stableKey, { msg, _sourceText: text });
  return msg;
}
function agentRoundStatus(stage, round, roundIndex, rounds, latestStageEvent) {
  if (roundIndex < rounds.length - 1) return "completed";
  const active = activeAgentStages().has(stage);
  const latestKind = String(latestStageEvent?.kind || "").trim().toLowerCase();
  const latestSummary = String(latestStageEvent?.summary || "");
  if (latestKind === "error") return "error";
  if (latestKind === "status" && /finished|completed|done/i.test(latestSummary)) {
    return "completed";
  }
  if (active) return "running";
  return "completed";
}
function mergeAgentReasoningDeltas(events) {
  const result = [];
  let accum = null;
  for (const event of events) {
    const kind = String(event?.kind || "").trim().toLowerCase();
    if (kind === "reasoning_delta") {
      if (!accum) {
        accum = { ...event };
      } else {
        const prev = String(accum._targetText || accum.summary || accum.text || "");
        const delta = String(event._targetText || event.summary || event.text || "");
        const merged = prev + delta;
        accum._targetText = merged;
        accum.summary = merged;
        if (typeof accum.text === "string") accum.text = merged;
        if (event.time?.created > (accum.time?.created || 0)) accum.time = event.time;
      }
    } else {
      if (accum) {
        result.push(accum);
        accum = null;
      }
      result.push(event);
    }
  }
  if (accum) result.push(accum);
  return result;
}
function computeAgentCards() {
  const roundsByStage = {};
  const latestEventByStage = /* @__PURE__ */ new Map();
  rootTaskSessionID();
  for (const message of store.messages) {
    const stage = message.info?.channel || classifyMessage(message);
    if (stage === "main" || stage === "filtered") continue;
    if (String(message.info?.role || "").toLowerCase() === "user") continue;
    const sessionID = typeof message?.info?.sessionID === "string" ? message.info.sessionID.trim() : "";
    const fallbackID = typeof message?.info?.id === "string" && message.info.id ? message.info.id : hashText$1(messageSignature(message));
    const channelID = sessionID ? `${stage}:session:${sessionID}` : `${stage}:message:${fallbackID}`;
    const round = roundsByStage[stage] || [];
    let entry = round.find((item) => item.channelID === channelID);
    if (!entry) {
      entry = {
        channelID,
        stage,
        sessionID,
        messages: [],
        startTime: Infinity,
        endTime: 0
      };
      round.push(entry);
      roundsByStage[stage] = round;
    }
    entry.messages.push(message);
    const created = finiteMessageTime(message) ?? Infinity;
    if (created < entry.startTime) entry.startTime = created;
    const completed = messageEndTime(message);
    if (completed > entry.endTime) entry.endTime = completed;
  }
  const liveEventsByStage = /* @__PURE__ */ new Map();
  for (const event of store.agentEvents) {
    const stage = String(event?.stage || "").trim().toLowerCase();
    if (!stage) continue;
    const stageEvents = liveEventsByStage.get(stage) || [];
    stageEvents.push(event);
    liveEventsByStage.set(stage, stageEvents);
    latestEventByStage.set(stage, event);
  }
  for (const [stage, events] of liveEventsByStage) {
    if ((roundsByStage[stage]?.length ?? 0) > 0) continue;
    const merged = mergeAgentReasoningDeltas(
      events.slice().sort((left, right) => agentEventTime(left) - agentEventTime(right))
    );
    const messages = merged.map((event) => agentMessage(event)).filter((message) => !!message);
    if (messages.length === 0) continue;
    const startTime = agentEventTime(merged[0]);
    const endTime = agentEventTime(merged[merged.length - 1]);
    roundsByStage[stage] = [{
      channelID: `${stage}:live`,
      stage,
      sessionID: "",
      messages,
      startTime: Number.isFinite(startTime) && startTime > 0 ? startTime : Date.now(),
      endTime: Number.isFinite(endTime) && endTime > 0 ? endTime : Date.now()
    }];
  }
  const PER_GOAL_STAGES = /* @__PURE__ */ new Set(["planner", "executor", "evaluator"]);
  const sessionToGoal = /* @__PURE__ */ new Map();
  const goalInfoMap = /* @__PURE__ */ new Map();
  const goalIndexMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < (boardStore.board?.goalWorkflows || []).length; i++) {
    const gw = boardStore.board.goalWorkflows[i];
    goalInfoMap.set(gw.goalID, { id: gw.goalID, title: gw.goalTitle, status: gw.goalStatus });
    goalIndexMap.set(gw.goalID, i + 1);
  }
  const goalsLane = (boardStore.board?.lanes || []).find((l) => l.id === "goals");
  for (const card of goalsLane?.cards || []) {
    if (!goalInfoMap.has(card.id)) {
      goalInfoMap.set(card.id, { id: card.id, title: card.title || "", status: card.status || "pending" });
    }
    const sid = card?.metadata?.sessionID;
    if (typeof sid === "string" && sid) {
      sessionToGoal.set(sid, card.id);
    }
    const exSid = card?.metadata?.executorSessionID;
    if (typeof exSid === "string" && exSid) {
      sessionToGoal.set(exSid, card.id);
    }
    const plSid = card?.metadata?.plannerSessionID;
    if (typeof plSid === "string" && plSid) {
      sessionToGoal.set(plSid, card.id);
    }
  }
  {
    let nextIdx = goalIndexMap.size > 0 ? Math.max(...goalIndexMap.values()) + 1 : 1;
    for (const [gid] of goalInfoMap) {
      if (!goalIndexMap.has(gid)) {
        goalIndexMap.set(gid, nextIdx++);
      }
    }
  }
  function resolveGoalID(round) {
    if (round.sessionID && sessionToGoal.has(round.sessionID)) {
      return sessionToGoal.get(round.sessionID);
    }
    for (const msg of round.messages) {
      const gid = typeof msg?.info?.goalID === "string" ? msg.info.goalID : "";
      if (gid) return gid;
    }
    return "";
  }
  const nextCards = {};
  const nextOrder = [];
  function buildCard(stage, round, roundLabel, status) {
    let created = round.startTime;
    if (!Number.isFinite(created) || created <= 0) {
      created = Date.now();
    }
    return {
      _synthetic: true,
      _agentCard: true,
      _agentStage: stage,
      _agentStatus: status,
      _agentRound: roundLabel,
      _agentCardKey: round.channelID,
      _agentMessages: round.messages.slice().sort((left, right) => messageOrderTime(left) - messageOrderTime(right)),
      info: {
        id: `agent-card:${round.channelID}`,
        role: "agent-card",
        agent: stage,
        sessionID: round.sessionID,
        time: { created }
      },
      parts: []
    };
  }
  const goalStepCards = /* @__PURE__ */ new Map();
  for (const [stage, rounds] of Object.entries(roundsByStage)) {
    rounds.sort((left, right) => left.startTime - right.startTime);
    if (PER_GOAL_STAGES.has(stage)) {
      for (let index = 0; index < rounds.length; index += 1) {
        const round = rounds[index];
        const gid = resolveGoalID(round);
        const roundLabel = rounds.length > 1 ? index + 1 : 0;
        const status = agentRoundStatus(stage, round, index, rounds, latestEventByStage.get(stage));
        const card = buildCard(stage, round, roundLabel, status);
        if (gid) {
          const entries = goalStepCards.get(gid) || [];
          entries.push({ stage, card, startTime: round.startTime });
          goalStepCards.set(gid, entries);
        }
      }
    } else {
      for (let index = 0; index < rounds.length; index += 1) {
        const round = rounds[index];
        const roundLabel = rounds.length > 1 ? index + 1 : 0;
        const status = agentRoundStatus(stage, round, index, rounds, latestEventByStage.get(stage));
        const cardID = round.channelID;
        nextCards[cardID] = buildCard(stage, round, roundLabel, status);
        nextOrder.push(cardID);
      }
    }
  }
  const goalDescMap = /* @__PURE__ */ new Map();
  for (const gc of goalsLane?.cards || []) {
    const desc = gc.detail || gc.description;
    if (gc.id && desc) goalDescMap.set(gc.id, desc);
  }
  const goalStepsMap = /* @__PURE__ */ new Map();
  for (const gw of boardStore.board?.goalWorkflows || []) {
    goalStepsMap.set(gw.goalID, (gw.steps || []).map((s) => ({
      stepID: s.stepID,
      label: s.label,
      status: s.status,
      summary: s.summary
    })));
  }
  const goalContractsMap = /* @__PURE__ */ new Map();
  for (const gw of boardStore.board?.goalWorkflows || []) {
    if (Array.isArray(gw.contracts) && gw.contracts.length > 0) {
      goalContractsMap.set(gw.goalID, gw.contracts);
    }
  }
  for (const [gid] of goalInfoMap) {
    if (!goalStepCards.has(gid)) goalStepCards.set(gid, []);
  }
  for (const [gid, entries] of goalStepCards) {
    entries.sort((a, b) => a.startTime - b.startTime);
    const goalInfo = goalInfoMap.get(gid);
    if (entries.length === 0 && goalInfo?.status === "pending") {
      continue;
    }
    const groupKey = `goal-group:${gid}`;
    const groupStart = entries.length > 0 ? Math.min(...entries.map((e) => e.startTime)) : Date.now();
    const groupStatus = entries.length === 0 ? goalInfo?.status === "passed" || goalInfo?.status === "failed" ? goalInfo.status : "pending" : entries.some((e) => e.card._agentStatus === "running") ? "running" : entries.some((e) => e.card._agentStatus === "error") ? "error" : "completed";
    const goalSessionID = entries[0]?.card.info.sessionID;
    const groupCreated = Number.isFinite(groupStart) && groupStart > 0 ? groupStart : Date.now();
    nextCards[groupKey] = {
      _synthetic: true,
      _agentCard: true,
      _agentGoalGroup: true,
      _agentGoalID: gid,
      _agentGoalTitle: goalInfo?.title ?? "",
      _agentGoalStatus: goalInfo?.status ?? groupStatus,
      _agentGoalDescription: goalDescMap.get(gid) ?? "",
      _agentGoalSteps: goalStepsMap.get(gid),
      _agentContracts: goalContractsMap.get(gid),
      _agentInternalCards: entries.map((e) => e.card),
      _agentStage: "executor",
      _agentStatus: groupStatus,
      _agentRound: goalIndexMap.get(gid) ?? 0,
      _agentCardKey: groupKey,
      _agentMessages: [],
      info: {
        id: `agent-card:${groupKey}`,
        role: "agent-card",
        agent: "executor",
        sessionID: goalSessionID ?? "",
        time: { created: groupCreated }
      },
      parts: []
    };
    nextOrder.push(groupKey);
  }
  const TASK_STAGE_PRIORITY = { spec: 0, architect: 1, goal: 2 };
  nextOrder.sort((left, right) => {
    const lCard = nextCards[left];
    const rCard = nextCards[right];
    const lPrio = TASK_STAGE_PRIORITY[lCard?._agentStage || ""];
    const rPrio = TASK_STAGE_PRIORITY[rCard?._agentStage || ""];
    if (lPrio !== void 0 && rPrio !== void 0 && lPrio !== rPrio) {
      return lPrio - rPrio;
    }
    return messageOrderTime(lCard) - messageOrderTime(rCard) || left.localeCompare(right);
  });
  return { cards: nextCards, order: nextOrder };
}
const agentCardsMemo = createRoot(
  () => createMemo(computeAgentCards, { cards: {}, order: [] })
);
function agentCards() {
  return agentCardsMemo().cards;
}
function agentCardOrder() {
  return agentCardsMemo().order;
}
async function syncTask(taskID) {
  if (!taskID) {
    clearMessages();
    clearAgentEvents();
    return;
  }
  try {
    const [transcript, timeline] = await Promise.all([
      apiJson(`task/${encodeURIComponent(taskID)}/transcript`).catch(() => []),
      apiJson(`control/timeline?taskID=${encodeURIComponent(taskID)}`).catch(
        () => []
      )
    ]);
    const messages = mergeLoadedConversationMessages(
      Array.isArray(timeline) ? timeline : [],
      Array.isArray(transcript) ? transcript : []
    );
    setMessages(messages);
  } catch (e) {
    console.error("syncTask failed", e);
  }
}
let _convLoading = null;
let _convQueued = false;
function touchReasoningPart(part) {
  if (!part || part.type !== "reasoning") return part;
  if (typeof part.text !== "string") part.text = "";
  touchReasoningPart$1(part);
  return part;
}
async function loadConversation() {
  if (!boardStore.selectedTaskID) {
    setMessages([]);
    clearAgentEvents();
    return;
  }
  if (_convLoading) {
    _convQueued = true;
    await _convLoading;
    return;
  }
  const requestTaskID = String(boardStore.selectedTaskID || "");
  const loading = (async () => {
    do {
      _convQueued = false;
      const taskID = String(boardStore.selectedTaskID || "");
      if (!taskID) {
        setMessages([]);
        return;
      }
      const transcript = await fetch(
        apiUrl(`task/${encodeURIComponent(taskID)}/transcript`),
        {
          headers: { Accept: "application/json" }
        }
      ).then((res) => res.ok ? res.json() : []).catch(() => []);
      const timeline = await fetch(
        apiUrl(`control/timeline?taskID=${encodeURIComponent(taskID)}`),
        {
          headers: { Accept: "application/json" }
        }
      ).then((res) => res.ok ? res.json() : []).catch(() => []);
      if (taskID !== boardStore.selectedTaskID) continue;
      const merged = mergeLoadedConversationMessages(
        Array.isArray(timeline) ? timeline : [],
        Array.isArray(transcript) ? transcript : []
      ).map((message) => ({
        ...message,
        parts: Array.isArray(message?.parts) ? message.parts.map((part) => touchReasoningPart(part)) : []
      }));
      setMessages(merged);
      syncSectionPhases(boardStore.board, boardStore.changes.length);
    } while (_convQueued && requestTaskID === boardStore.selectedTaskID);
  })();
  _convLoading = loading;
  try {
    await loading;
  } finally {
    if (_convLoading === loading) {
      _convLoading = null;
    }
  }
}
function applyMessageEvent(event) {
  const type = event.type || "";
  const properties = typeof event?.properties === "object" && event.properties && !Array.isArray(event.properties) ? event.properties : typeof event?.payload === "object" && event.payload && !Array.isArray(event.payload) ? event.payload : {};
  if (type === "message.updated") {
    const info = properties.info;
    if (!info?.id) return false;
    const existing = messageById(info.id);
    if (existing) {
      const idx = store.messages.indexOf(existing);
      if (idx >= 0) {
        setStore("messages", idx, "info", mergeMessageInfo(existing.info, info));
      }
      return true;
    }
    const bufferedEntry = _pendingParts.get(info.id);
    if (bufferedEntry) _pendingParts.delete(info.id);
    const msg = { info: mergeMessageInfo(void 0, info), parts: bufferedEntry?.parts || [] };
    let insertIdx = 0;
    setStore(
      "messages",
      produce((msgs) => {
        insertIdx = insertSorted(msgs, msg);
      })
    );
    messageIndex.set(info.id, store.messages[insertIdx]);
    return true;
  }
  if (type === "message.part.updated") {
    const part = properties.part;
    if (!part?.id || !part?.messageID) return false;
    let message = messageById(part.messageID);
    if (!message) {
      const existing = _pendingParts.get(part.messageID);
      if (existing) {
        existing.parts.push(part);
      } else {
        _pendingParts.set(part.messageID, { parts: [part], created: Date.now() });
      }
      prunePendingParts();
      return true;
    }
    const idx = store.messages.indexOf(message);
    const partIdx = message.parts.findIndex((p) => p.id === part.id);
    if (partIdx >= 0) {
      setStore("messages", idx, "parts", partIdx, part);
    } else {
      setStore(
        "messages",
        idx,
        "parts",
        produce((parts) => {
          parts.push(part);
        })
      );
    }
    return true;
  }
  if (type === "message.part.delta") {
    if (typeof properties.delta !== "string") return false;
    if (properties.field !== "text" && properties.field !== "raw") return false;
    let message = messageById(properties.messageID);
    if (!message) {
      return false;
    }
    const msgIdx = store.messages.indexOf(message);
    const partIdx = message.parts.findIndex(
      (p) => p.id === properties.partID
    );
    if (properties.field === "raw") {
      if (partIdx < 0) return false;
      const part = message.parts[partIdx];
      if (part.type !== "tool" || !part.state) return false;
      setStore(
        "messages",
        msgIdx,
        "parts",
        partIdx,
        "state",
        "raw",
        (prev) => (prev || "") + properties.delta
      );
      return true;
    }
    if (partIdx < 0) {
      setStore(
        "messages",
        msgIdx,
        "parts",
        produce((parts) => {
          parts.push({
            id: properties.partID,
            type: "text",
            text: properties.delta,
            sessionID: properties.sessionID,
            messageID: properties.messageID
          });
        })
      );
      return true;
    }
    setStore(
      "messages",
      msgIdx,
      "parts",
      partIdx,
      "text",
      (prev) => (prev || "") + properties.delta
    );
    return true;
  }
  return false;
}
const FLUSH_INTERVAL = 50;
let eventQueue = [];
let flushTimer = null;
let lastFlushTime = 0;
function enqueueEvent(event) {
  eventQueue.push(event);
  if (flushTimer) return;
  if (Date.now() - lastFlushTime < FLUSH_INTERVAL) {
    flushTimer = setTimeout(flushEvents, FLUSH_INTERVAL);
    return;
  }
  flushEvents();
}
function coalesceDeltas(events) {
  if (events.length <= 1) return events;
  const out = [];
  for (const ev of events) {
    const p = ev?.properties;
    if (ev?.type === "message.part.delta" && p?.field === "text" && typeof p?.delta === "string" && out.length > 0) {
      const prev = out[out.length - 1];
      const pp = prev?.properties;
      if (prev?.type === "message.part.delta" && pp?.field === "text" && pp?.partID === p.partID && pp?.messageID === p.messageID) {
        pp.delta += p.delta;
        continue;
      }
    }
    out.push(ev);
  }
  return out;
}
function flushEvents() {
  if (eventQueue.length === 0) return;
  const events = coalesceDeltas(eventQueue);
  eventQueue = [];
  flushTimer = null;
  lastFlushTime = Date.now();
  batch(() => {
    for (const event of events) {
      applyMessageEvent(event);
    }
  });
}
function clearEventQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  eventQueue = [];
}
function displayString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function deltaString(value) {
  return typeof value === "string" ? value : "";
}
function streamingAgentKind(kind) {
  return kind === "message_delta" || kind === "reasoning_delta" || kind === "tool_delta";
}
function agentEventRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const AGENT_LIVE_INTERVAL = 32;
const agentLiveTimers = /* @__PURE__ */ new Map();
function agentEventKey(event) {
  const stage = String(event?.stage || "").trim().toLowerCase();
  const id = String(event?.id || "").trim();
  return stage && id ? `${stage}:${id}` : "";
}
function stopAgentLiveTimer(key) {
  const timer = agentLiveTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  agentLiveTimers.delete(key);
}
function nextLiveLength(live, target) {
  if (!target) return 0;
  if (!live) return Math.min(target.length, 1);
  const remaining = target.length - live.length;
  if (remaining <= 0) return target.length;
  if (remaining <= 4) return target.length;
  return Math.min(target.length, live.length + Math.max(1, Math.ceil(remaining / 2)));
}
function advanceAgentLiveText(key) {
  const index = store.agentEvents.findIndex(
    (item) => agentEventKey(item) === key
  );
  if (index < 0) {
    stopAgentLiveTimer(key);
    return;
  }
  const event = store.agentEvents[index];
  const target = typeof event?._targetText === "string" ? event._targetText : "";
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (!target) {
    stopAgentLiveTimer(key);
    return;
  }
  if (live.length >= target.length) {
    if (live !== target) {
      setStore("agentEvents", index, "_liveText", target);
    }
    stopAgentLiveTimer(key);
    return;
  }
  setStore("agentEvents", index, "_liveText", target.slice(0, nextLiveLength(live, target)));
  agentLiveTimers.set(
    key,
    setTimeout(() => advanceAgentLiveText(key), AGENT_LIVE_INTERVAL)
  );
}
function scheduleAgentLiveText(event) {
  const key = agentEventKey(event);
  if (!key) return;
  const target = typeof event?._targetText === "string" ? event._targetText : "";
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (!target || live.length >= target.length) {
    stopAgentLiveTimer(key);
    return;
  }
  if (agentLiveTimers.has(key)) return;
  agentLiveTimers.set(
    key,
    setTimeout(() => advanceAgentLiveText(key), AGENT_LIVE_INTERVAL)
  );
}
function agentEventTargetText(event) {
  if (!event) return "";
  const k = event.kind;
  if (k === "message_delta" || k === "reasoning_delta" || k === "status") {
    return deltaString(event.text ?? event.summary);
  }
  if (k === "tool_call" || k === "tool_delta") {
    return deltaString(event.text ?? event.payload?.text ?? event.summary);
  }
  if (k === "tool_result") {
    return displayString(
      event.payload?.output || event.payload?.result || event.summary
    );
  }
  return displayString(event.summary);
}
function syncAgentText(event) {
  if (!event) return;
  const target = agentEventTargetText(event);
  const live = typeof event._liveText === "string" ? event._liveText : "";
  if (!target) {
    stopAgentLiveTimer(agentEventKey(event));
    delete event._targetText;
    delete event._liveText;
    return;
  }
  event._targetText = target;
  event._liveText = live || target;
}
function agentEventEntry(raw) {
  const payload = agentEventRecord(raw?.payload) ? raw.payload : agentEventRecord(raw?.properties) ? raw.properties : {};
  const stage = String(payload.stage || "").trim().toLowerCase();
  const taskID = String(payload.taskID || raw?.taskID || "").trim();
  const kind = String(payload.kind || "status").trim().toLowerCase();
  const created = Number(raw?.timestamp || payload.timestamp || Date.now());
  const toolName = typeof payload.toolName === "string" && payload.toolName.trim() ? payload.toolName.trim() : typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "";
  const text = streamingAgentKind(kind) ? deltaString(payload.text) : displayString(payload.text);
  const summary = streamingAgentKind(kind) ? deltaString(raw?.summary ?? payload.summary ?? text) : displayString(raw?.summary || payload.summary || text);
  const id = typeof payload.id === "string" && payload.id ? payload.id : typeof raw?.event_id === "string" && raw.event_id ? raw.event_id : `${stage}:${kind}:${toolName || "event"}:${created}`;
  if (!stage) return null;
  if (!summary && !text && !toolName) return null;
  return {
    id,
    eventID: typeof raw?.event_id === "string" ? raw.event_id : "",
    taskID,
    stage,
    kind,
    toolName,
    text,
    summary,
    payload,
    time: { created: Number.isFinite(created) ? created : Date.now() }
  };
}
function pruneAgentEvents(events) {
  const byStage = /* @__PURE__ */ new Map();
  for (const event of events) {
    const stageEvents = byStage.get(event.stage) || [];
    stageEvents.push(event);
    byStage.set(event.stage, stageEvents);
  }
  const kept = Array.from(byStage.values()).flatMap((stageEvents) => stageEvents.slice(-12)).sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
  const liveKeys = new Set(kept.map((event) => agentEventKey(event)));
  for (const key of [...agentLiveTimers.keys()]) {
    if (!liveKeys.has(key)) stopAgentLiveTimer(key);
  }
  if (_agentMsgCache.size > 0) {
    const cacheKeys = /* @__PURE__ */ new Set();
    for (const event of kept) {
      const sk = agentMessageStableKey(event);
      if (sk) cacheKeys.add(sk);
    }
    for (const cachedKey of [..._agentMsgCache.keys()]) {
      if (!cacheKeys.has(cachedKey)) _agentMsgCache.delete(cachedKey);
    }
  }
  return kept;
}
function mergeAgentEvent(existing, next) {
  if (!existing) return next;
  if (next.kind === "message_delta" || next.kind === "reasoning_delta") {
    const merged = `${deltaString(existing._targetText ?? existing.text ?? existing.summary)}${deltaString(next.text ?? next.summary)}`;
    return {
      ...existing,
      ...next,
      text: merged,
      summary: merged,
      payload: {
        ...agentEventRecord(existing.payload) ? existing.payload : {},
        ...agentEventRecord(next.payload) ? next.payload : {}
      }
    };
  }
  if (next.kind === "tool_delta") {
    const mergedText = `${deltaString(existing.text ?? existing.payload?.text ?? "")}${deltaString(next.text ?? next.payload?.text ?? next.summary)}`;
    return {
      ...existing,
      ...next,
      kind: existing.kind === "tool_result" ? "tool_result" : "tool_call",
      text: mergedText,
      summary: displayString(existing.summary || next.summary),
      payload: {
        ...agentEventRecord(existing.payload) ? existing.payload : {},
        ...agentEventRecord(next.payload) ? next.payload : {},
        text: mergedText
      }
    };
  }
  if (next.kind === "tool_result") {
    return {
      ...existing,
      ...next,
      payload: {
        ...agentEventRecord(existing.payload) ? existing.payload : {},
        ...agentEventRecord(next.payload) ? next.payload : {},
        text: displayString(
          existing.payload?.text || existing.text || next.payload?.text || ""
        )
      }
    };
  }
  return {
    ...existing,
    ...next,
    payload: {
      ...agentEventRecord(existing.payload) ? existing.payload : {},
      ...agentEventRecord(next.payload) ? next.payload : {}
    }
  };
}
let agentEventQueue = [];
let agentFlushTimer = null;
let agentLastFlush = 0;
const AGENT_FLUSH_INTERVAL = 16;
function flushAgentEvents() {
  if (agentEventQueue.length === 0) return;
  const queued = agentEventQueue;
  agentEventQueue = [];
  agentFlushTimer = null;
  agentLastFlush = Date.now();
  const byKey = /* @__PURE__ */ new Map();
  for (const e of store.agentEvents) {
    const key = `${e.stage}:${e.id}`;
    byKey.set(key, { ...e });
  }
  const affectedKeys = [];
  for (const raw of queued) {
    const event = agentEventEntry(raw);
    if (!event) continue;
    if (event.taskID && boardStore.selectedTaskID && event.taskID !== boardStore.selectedTaskID) continue;
    const key = `${event.stage}:${event.id}`;
    const existing = byKey.get(key);
    const merged = existing ? mergeAgentEvent(existing, event) : event;
    syncAgentText(merged);
    byKey.set(key, merged);
    affectedKeys.push(key);
  }
  const sorted = [...byKey.values()].sort(
    (a, b) => (a.time?.created || 0) - (b.time?.created || 0)
  );
  const pruned = pruneAgentEvents(sorted);
  setStore("agentEvents", pruned);
  for (const key of affectedKeys) {
    const target = pruned.find((e) => `${e.stage}:${e.id}` === key);
    if (target) scheduleAgentLiveText(target);
  }
}
function appendAgentEvent(raw) {
  agentEventQueue.push(raw);
  if (agentFlushTimer) return;
  if (Date.now() - agentLastFlush < AGENT_FLUSH_INTERVAL) {
    agentFlushTimer = setTimeout(flushAgentEvents, AGENT_FLUSH_INTERVAL);
    return;
  }
  flushAgentEvents();
}
function setAgentEvents(events) {
  for (const key of agentLiveTimers.keys()) {
    stopAgentLiveTimer(key);
  }
  const normalized = pruneAgentEvents(Array.isArray(events) ? events : []);
  setStore("agentEvents", normalized);
}
function clearAgentEvents() {
  for (const key of [...agentLiveTimers.keys()]) {
    stopAgentLiveTimer(key);
  }
  setStore("agentEvents", []);
  _agentMsgCache.clear();
}
function setMessages(messages) {
  const next = sortMessages(Array.isArray(messages) ? messages : []);
  setStore("messages", produce((msgs) => {
    const nextById = /* @__PURE__ */ new Map();
    for (const m of next) {
      const id = m?.info?.id;
      if (id) nextById.set(id, m);
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const id = msgs[i]?.info?.id;
      if (!id || !nextById.has(id)) msgs.splice(i, 1);
    }
    const existingIdx = /* @__PURE__ */ new Map();
    for (let i = 0; i < msgs.length; i++) {
      const id = msgs[i]?.info?.id;
      if (id) existingIdx.set(id, i);
    }
    for (const m of next) {
      const id = m?.info?.id;
      if (!id) {
        msgs.push(m);
        continue;
      }
      const idx = existingIdx.get(id);
      if (idx !== void 0) {
        const existing = msgs[idx];
        if (existing.info) Object.assign(existing.info, m.info);
        if (m.parts) {
          existing.parts.length = 0;
          existing.parts.push(...m.parts);
        }
      } else {
        msgs.push(m);
      }
    }
    msgs.sort((a, b) => messageOrderTime(a) - messageOrderTime(b));
  }));
  rebuildMessageIndex();
}
function setSelectedTaskID(taskID) {
  if (store.selectedTaskID !== taskID) {
    clearConversationUiState();
  }
  setStore("selectedTaskID", taskID);
}
function setSseConnected(connected) {
  setStore("sseConnected", connected);
}
function clearMessages() {
  setStore("messages", []);
  messageIndex.clear();
  _pendingParts.clear();
}
function setChatRequest(req) {
  setStore("chatRequest", req ?? null);
}
function abortChatRequest() {
  const req = store.chatRequest;
  if (req) {
    try {
      req.abort();
    } catch (_) {
    }
  }
  setStore("chatRequest", null);
}
function setChatAttachments(attachments) {
  setStore("chatAttachments", Array.isArray(attachments) ? attachments : []);
}
function currentTaskSessionID$1() {
  const boardSession = boardStore.board?.task?.sessionID;
  if (typeof boardSession === "string" && boardSession) return boardSession;
  const taskID = store.selectedTaskID;
  if (!taskID) return "";
  const entry = boardStore.tasks.find(
    (item) => item?.task?.id === taskID
  );
  return typeof entry?.task?.sessionID === "string" ? entry.task.sessionID : "";
}
function messageEventSessionID(event) {
  const properties = typeof event?.properties === "object" && event.properties && !Array.isArray(event.properties) ? event.properties : typeof event?.payload === "object" && event.payload && !Array.isArray(event.payload) ? event.payload : {};
  if (typeof properties?.info?.sessionID === "string") {
    return properties.info.sessionID;
  }
  if (typeof properties?.part?.sessionID === "string") {
    return properties.part.sessionID;
  }
  return typeof properties?.sessionID === "string" ? properties.sessionID : "";
}
function shouldReloadConversationForMessageEvent(event) {
  const type = String(event?.type || "").trim();
  if (type !== "message.updated" && type !== "message.part.updated" && type !== "message.part.delta") {
    return false;
  }
  if (!store.selectedTaskID) return false;
  if (currentTaskSessionID$1()) return false;
  return !!messageEventSessionID(event);
}

function record$3(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function parseToolInput(raw) {
  if (record$3(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  return {};
}
function executorMessageID(properties) {
  const goalRunID = properties.goalRunID || properties.goal_run_id || "";
  const execSessionID = properties.executorSessionID || properties.executor_session_id || "";
  const runID = properties.runID || "";
  const scope = goalRunID || execSessionID || runID || "default";
  return `executor:msg:${scope}`;
}
function executorPartID(properties, eventID) {
  const callID = properties.sourceID || properties.id || properties.payload?.id || eventID;
  return `executor:part:${callID}`;
}
function executorSessionID(properties) {
  return properties.sessionID || properties.session_id || properties.goalSessionID || properties.goal_session_id || properties.goalRunSessionID || properties.goal_run_session_id || properties.executorSessionID || properties.executor_session_id || properties.goalRunID || properties.goal_run_id || properties.runID || "";
}
function convertExecutorEventToMessages(event, properties) {
  const kind = executorEventKind(properties.type);
  const timestamp = Number(event.timestamp || Date.now());
  const msgID = executorMessageID(properties);
  const sessionID = executorSessionID(properties);
  const messageEvent = {
    type: "message.updated",
    properties: {
      info: {
        id: msgID,
        sessionID,
        role: "assistant",
        resolvedRole: "executor",
        agent: "executor",
        time: { created: timestamp }
      }
    }
  };
  if (kind === "tool_call") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool";
    const input = parseToolInput(properties.input ?? properties.arguments ?? properties.args ?? properties.payload?.input);
    const partID = executorPartID(properties, event.event_id);
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "tool",
            tool: name,
            callID: properties.sourceID || properties.id || properties.payload?.id || partID,
            state: {
              status: "running",
              input,
              title: event.summary || name,
              metadata: { synthetic: true },
              time: { start: timestamp }
            }
          }
        }
      }
    ];
  }
  if (kind === "tool_result") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool";
    const input = parseToolInput(properties.input ?? properties.arguments ?? properties.payload?.input ?? {});
    const output = typeof properties.output === "string" ? properties.output : typeof properties.payload?.output === "string" ? properties.payload.output : event.summary || "";
    const partID = executorPartID(properties, event.event_id);
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "tool",
            tool: name,
            callID: properties.sourceID || properties.id || properties.payload?.id || partID,
            state: {
              status: "completed",
              input,
              output,
              title: event.summary || name,
              metadata: { synthetic: true },
              time: { start: timestamp, end: timestamp }
            }
          }
        }
      }
    ];
  }
  if (kind === "message_delta") {
    const text = typeof properties.text === "string" ? properties.text : event.summary || "";
    if (!text) return [];
    const partID = `executor:text:${sessionID}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: ""
          }
        }
      },
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "text",
          delta: text
        }
      }
    ];
  }
  if (kind === "reasoning_delta") {
    const text = typeof properties.text === "string" ? properties.text : event.summary || "";
    if (!text) return [];
    const partID = `executor:reasoning:${sessionID}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "reasoning",
            text: ""
          }
        }
      },
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "text",
          delta: text
        }
      }
    ];
  }
  if (kind === "error") {
    const text = event.summary || properties.message || "Error";
    const partID = `executor:error:${event.event_id || timestamp}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: `Error: ${text}`
          }
        }
      }
    ];
  }
  if (event.summary) {
    const partID = `executor:status:${event.event_id || timestamp}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: event.summary,
            kind: "trace"
          }
        }
      }
    ];
  }
  return [];
}
function routeSSEEvent(event) {
  const type = event.type || "";
  if (type === "message.updated" || type === "message.part.updated" || type === "message.part.delta") {
    if (shouldReloadConversationForMessageEvent(event)) {
      void loadConversation();
      return true;
    }
    enqueueEvent(event);
    return true;
  }
  if (type === "task.replay_expired") {
    const taskID = boardStore.selectedTaskID || "";
    if (taskID) void syncTask(taskID);
    return true;
  }
  const properties = record$3(event?.properties) ? event.properties : record$3(event?.payload) ? event.payload : {};
  if (type === "run.progress") {
    const progressType = properties.type || "";
    if (progressType === "protocol.raw" || progressType === "executor.status" || progressType === "executor.progress") {
      return true;
    }
    if (progressType === "message.part.updated" || progressType === "message.part.delta" || progressType === "message.updated") {
      return true;
    }
    const messages = convertExecutorEventToMessages(event, properties);
    for (const msg of messages) {
      enqueueEvent(msg);
    }
    return true;
  }
  if (type === "run.output") {
    const messages = convertExecutorEventToMessages(event, {
      ...properties,
      type: "text_delta",
      text: typeof properties.text === "string" ? properties.text : event.summary || ""
    });
    for (const msg of messages) {
      enqueueEvent(msg);
    }
    return true;
  }
  if (type === "config.changed") {
    void __vitePreload(async () => { const {loadConfigInfo} = await Promise.resolve().then(() => init);return { loadConfigInfo }},true              ?void 0:void 0).then(({ loadConfigInfo }) => loadConfigInfo()).catch(() => {
    });
    return true;
  }
  if (type === "agent.updated") {
    appendAgentEvent(event);
    return true;
  }
  if (type === "task.updated" || type === "task.completed" || type === "task.failed" || type === "task.cancelled" || type === "task.blocked" || type.startsWith("run.") || type.startsWith("plan.") || type.startsWith("goal.") || type.startsWith("delivery.") || type.startsWith("evaluation.") || type.startsWith("interaction.")) {
    return false;
  }
  return false;
}
function executorEventKind(progressType) {
  const t = String(progressType || "").trim().toLowerCase();
  if (!t) return "event";
  if (t === "message_delta" || t === "reasoning_delta") return t;
  if (t === "tool_call" || t === "tool_delta" || t === "tool_result") return t;
  if (t.includes("tool")) return t.includes("result") ? "tool_result" : "tool_call";
  if (t.includes("reason")) return "reasoning_delta";
  if (t.includes("error")) return "error";
  if (t.includes("done") || t.includes("completed")) return "done";
  if (t.includes("approval") || t === "permission.asked") return "approval_request";
  if (t.includes("command")) return "command";
  return "event";
}
const BOARD_EVENT_DEBOUNCE = 500;
let tasksKickTimer$1 = null;
function normalizedEventType(event) {
  const raw = String(event?.type || "").trim();
  return raw;
}
function eventTaskID(event) {
  return String(event?.properties?.taskID || event?.payload?.taskID || "");
}
function eventSequence(event) {
  const value = Number(event?.sequence);
  return Number.isFinite(value) ? value : 0;
}
function boardInvalidatingEvent(type) {
  return type === "task.updated" || type === "task.completed" || type === "task.failed" || type === "task.cancelled" || type === "task.blocked" || type.startsWith("run.") || type.startsWith("plan.") || type.startsWith("goal.") || type.startsWith("delivery.") || type.startsWith("evaluation.") || type.startsWith("interaction.") || type.startsWith("workflow.");
}
function scheduleTasksCompat(delay = 0) {
  if (tasksKickTimer$1) clearTimeout(tasksKickTimer$1);
  tasksKickTimer$1 = setTimeout(() => {
    tasksKickTimer$1 = null;
    void loadTasks();
  }, delay);
}
function handleEventStreamEvent(event) {
  const type = normalizedEventType(event);
  if (type.startsWith("message.")) {
    if (shouldReloadConversationForMessageEvent({ ...event, type })) {
      void loadConversation();
      return;
    }
    enqueueEvent({ ...event, type });
    return;
  }
  if (type === "task.replay_expired") {
    if (boardStore.selectedTaskID) void syncTask(boardStore.selectedTaskID);
    scheduleTasksCompat(0);
    scheduleBoard(0);
    return;
  }
  const taskID = eventTaskID(event);
  const sequence = eventSequence(event);
  if (taskID && taskID === boardStore.selectedTaskID && sequence > 0) {
    const current = boardStore.taskSequence;
    if (current > 0 && sequence <= current) return;
    if (current > 0 && sequence > current + 1) {
      scheduleBoard(BOARD_EVENT_DEBOUNCE);
      scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
    }
    setTaskSequence(sequence);
  }
  if (boardInvalidatingEvent(type)) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
    if (taskID && taskID === boardStore.selectedTaskID) {
      scheduleBoard(BOARD_EVENT_DEBOUNCE);
    }
  }
}

let sseSource = null;
let sseRetryTimer = null;
function startSSE(taskID) {
  stopSSE();
  setSseConnected(false);
  const after = Number(boardStore.taskSequence || 0);
  const path = after > 0 ? `task/${encodeURIComponent(taskID)}/events?after=${after}` : `task/${encodeURIComponent(taskID)}/events`;
  const url = apiUrl(path);
  const source = new EventSource(url);
  sseSource = source;
  source.onopen = () => {
    setSseConnected(true);
  };
  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === "task.heartbeat" || event.type === "task.connected")
        return;
      const handled = routeSSEEvent(event);
      if (!handled) {
        handleEventStreamEvent(event);
      }
    } catch {
    }
  };
  source.onerror = () => {
    if (source !== sseSource) return;
    if (source.readyState === EventSource.CLOSED) {
      setSseConnected(false);
      sseSource = null;
      if (sseRetryTimer) clearTimeout(sseRetryTimer);
      sseRetryTimer = setTimeout(async () => {
        sseRetryTimer = null;
        if (boardStore.selectedTaskID !== taskID) return;
        await syncTask(taskID);
        await loadBoard();
        startSSE(taskID);
      }, 3e3);
    } else {
      setSseConnected(false);
    }
  };
}
function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  if (sseSource) {
    sseSource.close();
  }
  sseSource = null;
  setSseConnected(false);
  clearEventQueue();
}

function sanitizeTheme$1(value) {
  const text = String(value || "").trim();
  return text === "light" || text === "dark" || text === "vscode-dark" || text === "system" ? text : "dark";
}
const MIN_WINDOW_OPACITY = 0.5;
function sanitizeOpacity(value) {
  const n = parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return 0.8;
  return Math.max(
    MIN_WINDOW_OPACITY,
    Math.min(1, Math.round(n * 100) / 100)
  );
}
function sanitizeZoom$1(value) {
  const n = parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.6, Math.max(0.8, n));
}
function sanitizePaneWidth(value) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
function defaultAutoServer(url) {
  return !url || url === DEFAULT_SERVER;
}
function sanitizeAutoServer(value, serverUrl) {
  if (value === true || value === false) return value;
  return defaultAutoServer(serverUrl);
}
const DEFAULT_LOCALE = sanitizeLocale(
  typeof document !== "undefined" ? document.documentElement.lang : typeof navigator !== "undefined" ? navigator.language : "en-US"
);
const DEFAULT_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  autoServer: true,
  password: "",
  username: "opencorvus",
  executor: "opencode",
  initGit: true,
  alwaysOnTop: false,
  showTranscriptDetails: false,
  sidebarCollapsed: false,
  sidebarWidth: null,
  sectionsWidth: null,
  workspacePanelHeight: null,
  opacity: 0.8,
  zoom: 1,
  theme: "dark",
  locale: DEFAULT_LOCALE,
  directoryMode: "temp",
  directory: "",
  workspaceTaskID: "",
  workspaceDirectory: "",
  savedDirectory: "",
  tempDirectory: "",
  workspaceEpoch: 0,
  directoryEpoch: 0,
  toolPermissions: {
    websearch: "allow",
    webfetch: "allow",
    skill: "allow",
    external_directory: "allow",
    task: "allow",
    schedule: "allow"
  }
};
const [settingsStore, setSettingsStore] = createStore({ ...DEFAULT_SETTINGS });
function applySettings(input) {
  const serverUrl = typeof input?.serverUrl === "string" && input.serverUrl.trim() ? input.serverUrl.trim() : DEFAULT_SETTINGS.serverUrl;
  setSettingsStore({
    serverUrl,
    autoServer: sanitizeAutoServer(input?.autoServer, serverUrl),
    password: typeof input?.password === "string" ? input.password : DEFAULT_SETTINGS.password,
    username: typeof input?.username === "string" && input.username.trim() ? input.username.trim() : DEFAULT_SETTINGS.username,
    executor: typeof input?.executor === "string" && input.executor.trim() ? input.executor.trim() : DEFAULT_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: input?.alwaysOnTop === true,
    showTranscriptDetails: input?.showTranscriptDetails === true,
    sidebarCollapsed: input?.sidebarCollapsed === true,
    sidebarWidth: sanitizePaneWidth(input?.sidebarWidth),
    sectionsWidth: sanitizePaneWidth(input?.sectionsWidth),
    workspacePanelHeight: sanitizePaneWidth(input?.workspacePanelHeight),
    opacity: sanitizeOpacity(input?.opacity),
    zoom: sanitizeZoom$1(input?.zoom),
    theme: sanitizeTheme$1(input?.theme),
    locale: sanitizeLocale(
      (typeof input?.locale === "string" ? input.locale : "") || DEFAULT_SETTINGS.locale
    ),
    directoryMode: typeof input?.directory === "string" && input.directory.trim() ? "custom" : "temp",
    directory: typeof input?.directory === "string" ? input.directory.trim() : "",
    workspaceTaskID: typeof input?.workspaceTaskID === "string" ? input.workspaceTaskID.trim() : DEFAULT_SETTINGS.workspaceTaskID,
    workspaceDirectory: typeof input?.workspaceDirectory === "string" ? input.workspaceDirectory.trim() : DEFAULT_SETTINGS.workspaceDirectory
  });
}
function saveSettings() {
  const s = settingsStore;
  localStorage.setItem("oc_server_url", s.serverUrl);
  localStorage.setItem("oc_auto_server", String(s.autoServer));
  localStorage.setItem("oc_password", s.password);
  localStorage.setItem("oc_username", s.username);
  localStorage.setItem("oc_executor", s.executor || DEFAULT_SETTINGS.executor);
  localStorage.setItem("oc_always_on_top", String(s.alwaysOnTop));
  localStorage.removeItem("oc_unattended");
  localStorage.removeItem("oc_auto_permission");
  localStorage.removeItem("oc_auto_question");
  localStorage.removeItem("oc_workspace_width");
  localStorage.setItem(
    "oc_show_transcript_details",
    String(s.showTranscriptDetails)
  );
  localStorage.setItem("oc_sidebar_collapsed", String(s.sidebarCollapsed));
  if (s.sidebarWidth != null) {
    localStorage.setItem("oc_sidebar_width", String(s.sidebarWidth));
  } else {
    localStorage.removeItem("oc_sidebar_width");
  }
  if (s.sectionsWidth != null) {
    localStorage.setItem("oc_sections_width", String(s.sectionsWidth));
  } else {
    localStorage.removeItem("oc_sections_width");
  }
  if (s.workspacePanelHeight != null) {
    localStorage.setItem("oc_workspace_height", String(s.workspacePanelHeight));
  } else {
    localStorage.removeItem("oc_workspace_height");
  }
  localStorage.setItem("oc_opacity", String(s.opacity));
  localStorage.setItem("oc_zoom", String(s.zoom));
  localStorage.setItem("oc_theme", s.theme || DEFAULT_SETTINGS.theme);
  localStorage.setItem("oc_locale", s.locale || DEFAULT_SETTINGS.locale);
  if (s.workspaceTaskID) {
    localStorage.setItem("oc_workspace_task", s.workspaceTaskID);
  } else {
    localStorage.removeItem("oc_workspace_task");
  }
  if (s.workspaceDirectory) {
    localStorage.setItem("oc_workspace_directory", s.workspaceDirectory);
  } else {
    localStorage.removeItem("oc_workspace_directory");
  }
  if (s.directory) {
    localStorage.setItem("oc_directory", s.directory);
    localStorage.setItem("oc_directory_mode", s.directoryMode);
  } else {
    localStorage.removeItem("oc_directory");
    localStorage.removeItem("oc_directory_mode");
  }
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    void invoke("overlay_settings_save", {
      settings: bootstrapOverlaySettings(s)
    }).catch(() => void 0);
  }
}
function loadSettings() {
  const serverUrl = localStorage.getItem("oc_server_url") || DEFAULT_SETTINGS.serverUrl;
  const autoServerRaw = localStorage.getItem("oc_auto_server");
  const autoServer = autoServerRaw === null ? defaultAutoServer(serverUrl) : autoServerRaw !== "false";
  const directory = (() => {
    const raw = localStorage.getItem("oc_directory") || "";
    return raw.trim();
  })();
  setSettingsStore({
    serverUrl,
    autoServer,
    password: localStorage.getItem("oc_password") || DEFAULT_SETTINGS.password,
    username: localStorage.getItem("oc_username") || DEFAULT_SETTINGS.username,
    executor: localStorage.getItem("oc_executor") || DEFAULT_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: localStorage.getItem("oc_always_on_top") === "true",
    showTranscriptDetails: localStorage.getItem("oc_show_transcript_details") === "true",
    sidebarCollapsed: localStorage.getItem("oc_sidebar_collapsed") === "true",
    sidebarWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sidebar_width")
    ),
    sectionsWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sections_width")
    ),
    workspacePanelHeight: sanitizePaneWidth(
      localStorage.getItem("oc_workspace_height")
    ),
    opacity: sanitizeOpacity(localStorage.getItem("oc_opacity")),
    zoom: sanitizeZoom$1(localStorage.getItem("oc_zoom")),
    theme: sanitizeTheme$1(localStorage.getItem("oc_theme")),
    locale: sanitizeLocale(
      localStorage.getItem("oc_locale") || DEFAULT_SETTINGS.locale
    ),
    directoryMode: directory ? "custom" : "temp",
    directory,
    workspaceTaskID: localStorage.getItem("oc_workspace_task") || DEFAULT_SETTINGS.workspaceTaskID,
    workspaceDirectory: localStorage.getItem("oc_workspace_directory") || DEFAULT_SETTINGS.workspaceDirectory,
    // Runtime-only fields — not persisted in localStorage; reset to defaults on load.
    savedDirectory: directory,
    tempDirectory: DEFAULT_SETTINGS.tempDirectory,
    workspaceEpoch: DEFAULT_SETTINGS.workspaceEpoch,
    directoryEpoch: DEFAULT_SETTINGS.directoryEpoch
  });
}
function setSavedDirectory(path) {
  setSettingsStore("savedDirectory", typeof path === "string" ? path : "");
}
function bumpWorkspaceEpoch() {
  setSettingsStore("workspaceEpoch", (n) => n + 1);
}
function bumpDirectoryEpoch() {
  setSettingsStore("directoryEpoch", (n) => n + 1);
}
function sanitizeDirectoryMode$1(value, directory) {
  if (value === "custom") return "custom";
  if (typeof value === "string" && value.trim() === "temp") return "temp";
  return typeof directory === "string" && directory.trim() ? "custom" : DEFAULT_SETTINGS.directoryMode;
}
function savedDirectoryValue$1(directory, mode) {
  const next = typeof directory === "string" ? directory.trim() : "";
  if (!next) return "";
  return sanitizeDirectoryMode$1(mode, next) === "custom" ? next : "";
}
function bootstrapOverlaySettings(input = settingsStore) {
  return {
    serverUrl: input.serverUrl ?? DEFAULT_SETTINGS.serverUrl,
    autoServer: input.autoServer ?? DEFAULT_SETTINGS.autoServer,
    password: input.password ?? DEFAULT_SETTINGS.password,
    username: input.username ?? DEFAULT_SETTINGS.username,
    executor: input.executor ?? DEFAULT_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: input.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop,
    showTranscriptDetails: input.showTranscriptDetails ?? DEFAULT_SETTINGS.showTranscriptDetails,
    sidebarCollapsed: input.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth || void 0,
    sectionsWidth: input.sectionsWidth || void 0,
    workspacePanelHeight: input.workspacePanelHeight || void 0,
    opacity: input.opacity ?? DEFAULT_SETTINGS.opacity,
    zoom: input.zoom ?? DEFAULT_SETTINGS.zoom,
    theme: input.theme ?? DEFAULT_SETTINGS.theme,
    locale: input.locale ?? DEFAULT_SETTINGS.locale,
    directoryMode: input.savedDirectory ? "custom" : "temp",
    directory: input.savedDirectory || void 0,
    workspaceTaskID: input.workspaceTaskID || void 0,
    workspaceDirectory: input.workspaceDirectory || void 0,
    toolPermissions: input.toolPermissions ?? DEFAULT_SETTINGS.toolPermissions
  };
}

async function selectTask(taskID, options = {}) {
  const nextTaskID = taskID || "";
  if (nextTaskID === boardStore.selectedTaskID && boardStore.board) {
    return;
  }
  abortChatRequest();
  setChatAttachments([]);
  stopSSE();
  clearBoard();
  clearMessages();
  clearAgentEvents();
  if (appStore.budgetDirty) {
    setAppStore("budgetDirty", false);
  }
  setSelectedTaskID(nextTaskID);
  setBoardStore("selectedTaskID", nextTaskID);
  if (!nextTaskID) {
    return;
  }
  await Promise.all([
    loadBoard({ sync: true }).catch(
      (e) => console.error("[selectTask] loadBoard failed:", e)
    ),
    syncTask(nextTaskID).catch(
      (e) => console.error("[selectTask] syncTask failed:", e)
    )
  ]);
  startSSE(nextTaskID);
}
async function deleteTask(taskID) {
  if (!taskID) return false;
  try {
    await apiJson(`task/${encodeURIComponent(taskID)}`, {
      method: "DELETE"
    });
    if (boardStore.selectedTaskID === taskID) {
      await selectTask("");
    }
    await loadTasks();
    return true;
  } catch (e) {
    console.error("[deleteTask] failed", { error: String(e), taskID });
    return false;
  }
}
async function createTask(options) {
  const { text, attachments = [], metadata = {}, signal, budget } = options;
  if (!text) throw new Error("createTask: text is required");
  const requestID = crypto.randomUUID();
  const executor = settingsStore.executor ?? "opencode";
  const result = await apiJson("task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request: text,
      executor,
      requestID,
      metadata,
      source: "panel",
      ...budget ? { budget } : {},
      ...attachments.length > 0 ? {
        attachments: attachments.map((att) => ({
          mime: att.mime,
          // TaskAttachment schema expects pure base64 (no data URL prefix)
          data: att.url.includes(",") ? att.url.split(",")[1] : att.url,
          ...att.filename ? { filename: att.filename } : {}
        }))
      } : {}
    }),
    signal
  });
  return typeof result?.task_id === "string" ? result.task_id : "";
}
async function retryTask(taskID) {
  if (!taskID) return;
  await apiJson(`task/${encodeURIComponent(taskID)}/retry`, {
    method: "POST"
  });
  await loadBoard();
}
async function replanTask(taskID) {
  if (!taskID) return;
  await apiJson(`task/${encodeURIComponent(taskID)}/replan`, {
    method: "POST"
  });
  await loadBoard();
}
async function cancelTask(taskID) {
  if (!taskID) return;
  await apiJson(`task/${encodeURIComponent(taskID)}/cancel`, {
    method: "POST"
  });
  await loadBoard();
}
async function interruptTask(taskID) {
  if (!taskID) return false;
  try {
    await apiJson(`task/${encodeURIComponent(taskID)}/cancel`, {
      method: "POST"
    });
    await loadBoard();
    return true;
  } catch (e) {
    console.error("[interruptTask] failed", { error: String(e), taskID });
    return false;
  }
}

function setupAutoScroll(el, threshold = 60) {
  let tracking = true;
  let rafPending = false;
  function onScroll() {
    tracking = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }
  function scrollDown() {
    if (!tracking || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      el.scrollTop = el.scrollHeight;
    });
  }
  el.addEventListener("scroll", onScroll, { passive: true });
  const observer = new MutationObserver(scrollDown);
  observer.observe(el, { childList: true, subtree: true, characterData: true });
  scrollDown();
  return () => {
    el.removeEventListener("scroll", onScroll);
    observer.disconnect();
  };
}
function jsonAttr(value) {
  return JSON.stringify(String(value ?? ""));
}
function eventClosest(event, selector) {
  const target = event?.target;
  if (target instanceof Element) return target.closest(selector);
  const parent = target?.parentElement;
  if (parent instanceof Element) return parent.closest(selector);
  return null;
}
function pathItems(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const windows = /^[A-Za-z]:[\\/]/.test(text);
  const unix = text.startsWith("/");
  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return [];
  function joinPath(a, b) {
    return a.replace(/[\\/]+$/, "") + "/" + b;
  }
  if (windows) {
    let path2 = `${parts[0]}\\`;
    const items2 = [{ label: parts[0], path: path2 }];
    return items2.concat(
      parts.slice(1).map((part) => {
        path2 = joinPath(path2, part);
        return { label: part, path: path2 };
      })
    );
  }
  if (unix) {
    let path2 = "/";
    const items2 = [{ label: "/", path: path2 }];
    return items2.concat(
      parts.map((part) => {
        path2 = path2 === "/" ? `/${part}` : `${path2}/${part}`;
        return { label: part, path: path2 };
      })
    );
  }
  let path = parts[0];
  const items = [{ label: parts[0], path }];
  return items.concat(
    parts.slice(1).map((part) => {
      path = path.replace(/[\\/]+$/, "") + "/" + part;
      return { label: part, path };
    })
  );
}
function pathIcon(kind) {
  if (kind === "browse") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h4l1.2 1.5h5.8v5.2a1.3 1.3 0 01-1.3 1.3H3.8a1.3 1.3 0 01-1.3-1.3V5.8a1.3 1.3 0 011.3-1.3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  }
  if (kind === "new") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  }
  if (kind === "history") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4v4l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.05 8a5 5 0 1 1 .5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M3 10.5L3.05 8 1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;
}
function pathBreadcrumb(value) {
  const browse = escapeHtml(t("cwd.browse"));
  const create = escapeHtml(t("cwd.new"));
  const reset = escapeHtml(t("cwd.reset"));
  const recent = escapeHtml(t("cwd.recent"));
  const directory = settingsStore.directory;
  const actions = [
    `<button type="button" class="task-dir-tool" data-path-action="recent" title="${recent}" aria-label="${recent}">${pathIcon("history")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="create" title="${create}" aria-label="${create}">${pathIcon("new")}</button>`,
    directory ? `<button type="button" class="task-dir-tool danger" data-path-action="reset" title="${reset}" aria-label="${reset}">${pathIcon("reset")}</button>` : ""
  ].filter(Boolean).join("");
  if (!value) {
    return `
      <span class="task-dir-shell" data-empty="true">
        <span class="task-dir-empty">${escapeHtml(t("cwd.unavailable"))}</span>
        <span class="task-dir-actions">${actions}</span>
      </span>
    `;
  }
  const items = pathItems(value);
  const open = t("cwd.open");
  const choose = t("cwd.choose_level");
  const nodes = items.map((item, index) => {
    const current = index === items.length - 1 ? ' data-current="true"' : "";
    const step = index ? `<button type="button" class="task-dir-step" data-path-set=${jsonAttr(items[index - 1].path)} title="${escapeHtml(`${choose}: ${items[index - 1].path}`)}" aria-label="${escapeHtml(`${choose}: ${items[index - 1].path}`)}">/</button>` : "";
    return `${step}<button type="button" class="task-dir-node" data-path-open=${jsonAttr(item.path)} title="${escapeHtml(`${open}: ${item.path}`)}" aria-label="${escapeHtml(`${open}: ${item.path}`)}"${current}>${escapeHtml(item.label)}</button>`;
  }).join("");
  return `
    <span class="task-dir-shell">
      <span class="task-dir-path">${nodes}</span>
      <span class="task-dir-actions">${actions}</span>
    </span>
  `;
}

var _tmpl$$r = /* @__PURE__ */ template(`<span>`), _tmpl$2$p = /* @__PURE__ */ template(`<span class=agent-card-round>#`), _tmpl$3$n = /* @__PURE__ */ template(`<article class="turn msg agent-card"data-role=agent-card><div class=agent-card-header role=button tabindex=0><span class=agent-card-label></span><span class=agent-card-count></span><span class=agent-card-chevron aria-hidden=true>▼</span></div><div class=agent-card-body>`), _tmpl$4$l = /* @__PURE__ */ template(`<span class="agent-card-badge agent-card-badge--running"title=Running><span class=agent-card-spinner>`);
function AgentCard(props) {
  const expanded = () => agentCardExpanded(props.cardID, props.status === "running");
  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, props.status === "running");
  };
  const badgeClass = () => {
    if (props.status === "running") return "agent-card-badge agent-card-badge--running";
    if (props.status === "error") return "agent-card-badge agent-card-badge--error";
    return "agent-card-badge agent-card-badge--done";
  };
  const badgeContent = () => {
    if (props.status === "running") return "";
    if (props.status === "error") return "✗";
    return "✓";
  };
  return (() => {
    var _el$ = _tmpl$3$n(), _el$2 = _el$.firstChild, _el$4 = _el$2.firstChild, _el$7 = _el$4.nextSibling, _el$8 = _el$2.nextSibling;
    _el$2.$$keydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    _el$2.$$click = toggle;
    insert(_el$2, createComponent(Show, {
      get when() {
        return props.status !== "running";
      },
      get fallback() {
        return _tmpl$4$l();
      },
      get children() {
        var _el$3 = _tmpl$$r();
        insert(_el$3, badgeContent);
        createRenderEffect((_p$) => {
          var _v$ = badgeClass(), _v$2 = props.status;
          _v$ !== _p$.e && className(_el$3, _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$3, "title", _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$3;
      }
    }), _el$4);
    insert(_el$4, () => agentStageLabel(props.stage));
    insert(_el$2, createComponent(Show, {
      get when() {
        return props.round > 0;
      },
      get children() {
        var _el$5 = _tmpl$2$p(); _el$5.firstChild;
        insert(_el$5, () => props.round, null);
        return _el$5;
      }
    }), _el$7);
    insert(_el$7, createComponent(Show, {
      get when() {
        return props.messages.length > 0;
      },
      get children() {
        return ["(", memo(() => props.messages.length), ")"];
      }
    }));
    use((el) => onCleanup(setupAutoScroll(el)), _el$8);
    insert(_el$8, createComponent(For, {
      get each() {
        return props.messages.filter((m) => String(m?.info?.role || "").toLowerCase() !== "user");
      },
      children: (msg) => createComponent(MessageView, {
        message: msg
      })
    }));
    createRenderEffect((_p$) => {
      var _v$3 = !!expanded(), _v$4 = props.stage, _v$5 = expanded(), _v$6 = !expanded();
      _v$3 !== _p$.e && _el$.classList.toggle("agent-card--expanded", _p$.e = _v$3);
      _v$4 !== _p$.t && setAttribute(_el$, "data-agent-stage", _p$.t = _v$4);
      _v$5 !== _p$.a && setAttribute(_el$2, "aria-expanded", _p$.a = _v$5);
      _v$6 !== _p$.o && _el$8.classList.toggle("agent-card-body--preview", _p$.o = _v$6);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    return _el$;
  })();
}
delegateEvents(["click", "keydown"]);

var _tmpl$$q = /* @__PURE__ */ template(`<span>`), _tmpl$2$o = /* @__PURE__ */ template(`<div class=executor-goal-description>`), _tmpl$3$m = /* @__PURE__ */ template(`<div class=executor-goal-contracts>`), _tmpl$4$k = /* @__PURE__ */ template(`<article class="turn msg executor-goal-block"data-role=executor-goal-group><div class=executor-goal-header role=button tabindex=0><span class=executor-goal-label></span><span class=executor-goal-id></span><span class=executor-goal-chevron aria-hidden=true>▼</span></div><div class=executor-goal-body>`), _tmpl$5$j = /* @__PURE__ */ template(`<span class="executor-goal-badge executor-goal-badge--running"title=Running><span class=agent-card-spinner>`), _tmpl$6$e = /* @__PURE__ */ template(`<div class=goal-contract><span class=goal-contract-key></span><div class=goal-contract-value>`), _tmpl$7$c = /* @__PURE__ */ template(`<span class=goal-step-icon>`), _tmpl$8$a = /* @__PURE__ */ template(`<span class=goal-step-summary>`), _tmpl$9$8 = /* @__PURE__ */ template(`<div class=goal-step-body>`), _tmpl$0$5 = /* @__PURE__ */ template(`<div><div class=goal-step-header><span class=goal-step-label>`), _tmpl$1$4 = /* @__PURE__ */ template(`<span class="goal-step-icon goal-step-icon--running"><span class=agent-card-spinner>`);
const STEP_ORDER = ["planner", "executor", "evaluator"];
function stepIDToStage(stepID) {
  if (stepID === "plan") return "planner";
  if (stepID === "execute") return "executor";
  if (stepID === "eval") return "evaluator";
  return stepID;
}
function stepStatusIcon$1(status) {
  if (status === "completed") return "✓";
  if (status === "running") return "○";
  if (status === "failed") return "✗";
  if (status === "skipped") return "—";
  return "·";
}
function stepStatusClass$1(status) {
  if (status === "completed") return "goal-step--done";
  if (status === "running") return "goal-step--running";
  if (status === "failed" || status === "error") return "goal-step--error";
  if (status === "skipped") return "goal-step--skipped";
  return "goal-step--pending";
}
function ExecutorGoalGroup(props) {
  const running = () => props.status === "running";
  const expanded = () => agentCardExpanded(props.cardID, running());
  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, running());
  };
  const badgeClass = () => {
    if (props.status === "running") return "executor-goal-badge executor-goal-badge--running";
    if (props.goalStatus === "passed") return "executor-goal-badge executor-goal-badge--done";
    if (props.goalStatus === "failed") return "executor-goal-badge executor-goal-badge--error";
    if (props.status === "error") return "executor-goal-badge executor-goal-badge--error";
    if (props.status === "pending") return "executor-goal-badge executor-goal-badge--pending";
    return "executor-goal-badge executor-goal-badge--done";
  };
  const badgeContent = () => {
    if (props.status === "pending") return "·";
    if (props.status === "running") return "";
    if (props.goalStatus === "passed") return "✓";
    if (props.goalStatus === "failed") return "✗";
    if (props.status === "error") return "✗";
    return "✓";
  };
  const cardsByStage = () => {
    const map = /* @__PURE__ */ new Map();
    for (const card of props.internalCards || []) {
      map.set(card._agentStage, card);
    }
    return map;
  };
  const sortedCards = () => {
    const cards = props.internalCards || [];
    return cards.slice().sort((a, b) => STEP_ORDER.indexOf(a._agentStage) - STEP_ORDER.indexOf(b._agentStage));
  };
  return (() => {
    var _el$ = _tmpl$4$k(), _el$2 = _el$.firstChild, _el$4 = _el$2.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$2.nextSibling;
    _el$2.$$keydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    _el$2.$$click = toggle;
    insert(_el$2, createComponent(Show, {
      get when() {
        return props.status !== "running";
      },
      get fallback() {
        return _tmpl$5$j();
      },
      get children() {
        var _el$3 = _tmpl$$q();
        insert(_el$3, badgeContent);
        createRenderEffect((_p$) => {
          var _v$ = badgeClass(), _v$2 = props.status;
          _v$ !== _p$.e && className(_el$3, _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$3, "title", _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$3;
      }
    }), _el$4);
    insert(_el$4, (() => {
      var _c$ = memo(() => (props.goalIndex ?? 0) > 0);
      return () => _c$() ? `Goal#${props.goalIndex} ` : "";
    })(), null);
    insert(_el$4, () => props.goalTitle || "Goal", null);
    _el$5.$$click = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(props.cardID).catch(() => {
      });
    };
    insert(_el$5, () => props.cardID.slice(-8));
    use((el) => onCleanup(setupAutoScroll(el)), _el$6);
    insert(_el$6, createComponent(Show, {
      get when() {
        return props.goalDescription;
      },
      get children() {
        var _el$7 = _tmpl$2$o();
        insert(_el$7, createComponent(StaticTextPart, {
          get text() {
            return props.goalDescription;
          }
        }));
        return _el$7;
      }
    }), null);
    insert(_el$6, createComponent(Show, {
      get when() {
        return memo(() => !!props.contracts)() && props.contracts.length > 0;
      },
      get children() {
        var _el$8 = _tmpl$3$m();
        insert(_el$8, createComponent(For, {
          get each() {
            return props.contracts;
          },
          children: (contract) => (() => {
            var _el$0 = _tmpl$6$e(), _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling;
            insert(_el$1, () => contract.key);
            insert(_el$10, createComponent(StaticTextPart, {
              get text() {
                return contract.value;
              }
            }));
            return _el$0;
          })()
        }));
        return _el$8;
      }
    }), null);
    insert(_el$6, createComponent(Show, {
      get when() {
        return (props.goalSteps || []).length > 0;
      },
      get fallback() {
        return createComponent(For, {
          get each() {
            return sortedCards();
          },
          children: (card) => createComponent(GoalStepCard, {
            get stage() {
              return card._agentStage;
            },
            get status() {
              return card._agentStatus;
            },
            get messages() {
              return card._agentMessages || [];
            }
          })
        });
      },
      get children() {
        return createComponent(For, {
          get each() {
            return props.goalSteps;
          },
          children: (step) => {
            const stage = stepIDToStage(step.stepID);
            const card = () => cardsByStage().get(stage);
            const msgs = () => card()?._agentMessages || [];
            const effectiveStatus = () => card()?._agentStatus || step.status;
            return createComponent(WorkflowStepRow, {
              step,
              get effectiveStatus() {
                return effectiveStatus();
              },
              get messages() {
                return msgs();
              }
            });
          }
        });
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$3 = !!expanded(), _v$4 = props.cardID, _v$5 = expanded(), _v$6 = props.cardID, _v$7 = !expanded();
      _v$3 !== _p$.e && _el$.classList.toggle("executor-goal-block--expanded", _p$.e = _v$3);
      _v$4 !== _p$.t && setAttribute(_el$, "data-goal-id", _p$.t = _v$4);
      _v$5 !== _p$.a && setAttribute(_el$2, "aria-expanded", _p$.a = _v$5);
      _v$6 !== _p$.o && setAttribute(_el$5, "title", _p$.o = _v$6);
      _v$7 !== _p$.i && _el$6.classList.toggle("executor-goal-body--preview", _p$.i = _v$7);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    return _el$;
  })();
}
function WorkflowStepRow(props) {
  return (() => {
    var _el$11 = _tmpl$0$5(), _el$12 = _el$11.firstChild, _el$14 = _el$12.firstChild;
    insert(_el$12, createComponent(Show, {
      get when() {
        return props.effectiveStatus !== "running";
      },
      get fallback() {
        return _tmpl$1$4();
      },
      get children() {
        var _el$13 = _tmpl$7$c();
        insert(_el$13, () => stepStatusIcon$1(props.effectiveStatus));
        return _el$13;
      }
    }), _el$14);
    insert(_el$14, () => props.step.label);
    insert(_el$12, createComponent(Show, {
      get when() {
        return props.step.summary;
      },
      get children() {
        var _el$15 = _tmpl$8$a();
        insert(_el$15, () => props.step.summary);
        return _el$15;
      }
    }), null);
    insert(_el$11, createComponent(Show, {
      get when() {
        return props.messages.length > 0;
      },
      get children() {
        var _el$16 = _tmpl$9$8();
        insert(_el$16, createComponent(For, {
          get each() {
            return props.messages.filter((m) => String(m?.info?.role || "").toLowerCase() !== "user");
          },
          children: (msg) => createComponent(MessageView, {
            message: msg
          })
        }));
        return _el$16;
      }
    }), null);
    createRenderEffect(() => className(_el$11, `goal-step ${stepStatusClass$1(props.effectiveStatus)}`));
    return _el$11;
  })();
}
function GoalStepCard(props) {
  return (() => {
    var _el$18 = _tmpl$0$5(), _el$19 = _el$18.firstChild, _el$21 = _el$19.firstChild;
    insert(_el$19, createComponent(Show, {
      get when() {
        return props.status !== "running";
      },
      get fallback() {
        return _tmpl$1$4();
      },
      get children() {
        var _el$20 = _tmpl$7$c();
        insert(_el$20, () => stepStatusIcon$1(props.status));
        return _el$20;
      }
    }), _el$21);
    insert(_el$21, () => props.stage);
    insert(_el$18, createComponent(Show, {
      get when() {
        return props.messages.length > 0;
      },
      get children() {
        var _el$22 = _tmpl$9$8();
        insert(_el$22, createComponent(For, {
          get each() {
            return props.messages.filter((m) => String(m?.info?.role || "").toLowerCase() !== "user");
          },
          children: (msg) => createComponent(MessageView, {
            message: msg
          })
        }));
        return _el$22;
      }
    }), null);
    createRenderEffect(() => className(_el$18, `goal-step ${stepStatusClass$1(props.status)}`));
    return _el$18;
  })();
}
delegateEvents(["click", "keydown"]);

function stripAssistantBrief(text) {
  const briefRe = /<assistant-brief>[\s\S]*?<\/assistant-brief>/;
  let cleaned = text.replace(briefRe, "");
  cleaned = cleaned.replace(/Use the brief above to align your work before executing the task\.\s*/g, "").replace(/You are executing a headless coding task[^\n]*\n?/g, "").replace(/^Task:\s*[^\n]*\n?/gm, "").replace(/^Goals:\n(?:- [^\n]*\n?)*/gm, "").replace(/^Request:\s*\n?/gm, "");
  return cleaned.trim();
}
function joinBullet$1(values) {
  return values.filter(Boolean).join(" / ");
}

const MAX_ENTRIES = 2e3;
const MAX_FLUSH_FAILURES = 5;
const LOG_LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
const entries = [];
let filterLevel = "debug";
let _flushQueue = [];
let _flushTimer = null;
let _flushFailCount = 0;
function now() {
  return (/* @__PURE__ */ new Date()).toISOString().split(".")[0];
}
function add(level, service, message, extra) {
  const entry = { ts: now(), level, service, message, extra };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  return entry;
}
function flush() {
  _flushTimer = null;
  const batch = _flushQueue.splice(0);
  if (batch.length === 0) return;
  for (const entry of batch) {
    const extraObj = entry.extra && typeof entry.extra === "object" ? entry.extra : void 0;
    const msg = entry.extra && !extraObj ? `${entry.message} ${entry.extra}` : entry.message;
    fetch(apiUrl("log"), {
      method: "POST",
      headers: { ...apiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "overlay:" + entry.service,
        level: entry.level,
        message: msg,
        extra: extraObj
      })
    }).then(() => {
      _flushFailCount = 0;
    }).catch(() => {
      _flushFailCount++;
      if (_flushFailCount <= MAX_FLUSH_FAILURES) {
        _flushQueue.push(entry);
      }
    });
  }
}
function persist(entry) {
  _flushQueue.push(entry);
  if (!_flushTimer) {
    _flushTimer = setTimeout(flush, 500);
  }
}
async function waitForLogDrain(timeoutMs = 2e3) {
  const started = Date.now();
  while (_flushTimer || _flushQueue.length > 0) {
    if (Date.now() - started >= timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
function log(level, service, message, extra) {
  const entry = add(level, service, message, extra);
  persist(entry);
  const storeEntry = {
    ts: entry.ts,
    level: entry.level,
    service: entry.service,
    delta: "",
    message: entry.message,
    fields: entry.extra && typeof entry.extra === "object" ? entry.extra : {},
    raw: "",
    source: "overlay"
  };
  appendLog(storeEntry);
  return entry;
}
const AppLog = {
  debug: (service, msg, extra) => log("debug", service, msg, extra),
  info: (service, msg, extra) => log("info", service, msg, extra),
  warn: (service, msg, extra) => log("warn", service, msg, extra),
  error: (service, msg, extra) => log("error", service, msg, extra),
  /** All accumulated entries (mutable reference, mirrors app.js behaviour). */
  entries,
  get filterLevel() {
    return filterLevel;
  },
  set filterLevel(v) {
    filterLevel = v;
  },
  /** Return entries filtered to at least the current filterLevel. */
  filtered() {
    const min = LOG_LEVEL_ORDER[filterLevel] ?? 0;
    return entries.filter((e) => (LOG_LEVEL_ORDER[e.level] ?? 0) >= min);
  },
  /** Clear the in-memory entry buffer. */
  clear() {
    entries.length = 0;
  }
};

function record$2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function transcriptRole(role) {
  return roleLabel(role);
}
function transcriptTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(localeTag(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}
function formatTranscriptText(part, role) {
  let text = part?.text || "";
  if (!text.trim()) return "";
  if (part.audience && part.audience.ui === false) return "";
  if (part.kind === "trace" && !part.audience?.ui) return "";
  const briefRoles = ["user", "planner", "evaluator", "system"];
  if (briefRoles.includes(role) && text.includes("<assistant-brief>")) {
    text = stripAssistantBrief(text);
  }
  return text.trim();
}
function formatTranscriptTool(part) {
  const toolName = part?.tool || "unknown";
  const hiddenTools = ["planner", "todowrite", "todoupdate", "task_report"];
  if (hiddenTools.includes(toolName.toLowerCase())) return "";
  const st = part?.state || {};
  const detail = displayToolDetail(toolName, st.input || {}, st);
  const status = st.status || "pending";
  return [t("transcript.tool", { status: toolStatusLabel(status), tool: toolName }), detail].filter(Boolean).join(" ");
}
function formatTranscriptPart(part, role) {
  if (!part || typeof part !== "object") return "";
  if (part.type === "text") return formatTranscriptText(part, role);
  if (part.type === "reasoning") {
    return part.text?.trim() ? `${t("transcript.reasoning")}
${part.text.trim()}` : "";
  }
  if (part.type === "tool") return formatTranscriptTool(part);
  if (part.type === "file") {
    return part.filename || part.url ? t("transcript.file", { value: part.filename || part.url }) : "";
  }
  if (part.type === "subtask") {
    const text = part.description || part.prompt || "";
    return text ? t("transcript.subtask", { value: text }) : "";
  }
  if (part.type === "patch") {
    const files = Array.isArray(part.files) ? part.files.filter(Boolean) : [];
    return files.length ? t("transcript.patch", { value: files.join(", ") }) : t("transcript.patch_empty");
  }
  if (part.type === "compaction") return t("transcript.compaction");
  return "";
}
async function copyText$1(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}
async function nativeMessage$2(message, options) {
  const fn = window.nativeMessage;
  if (typeof fn === "function") {
    await fn(message, options);
  }
}
function errorText$1(key, error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return `${t(key)}: ${detail}`;
}
const _syntheticCache = /* @__PURE__ */ new Map();
function syntheticTextMessage(role, time, text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const created = Number.isFinite(time) ? time : Date.now();
  const id = `synthetic:${role}:${created}:${hashText(text)}`;
  const cached = _syntheticCache.get(id);
  if (cached) return cached;
  const msg = {
    _synthetic: true,
    info: { id, role, resolvedRole: role, channel: "main", time: { created } },
    parts: [{ type: "text", text }]
  };
  _syntheticCache.set(id, msg);
  return msg;
}
function formatConversationTranscript(messages) {
  return (Array.isArray(messages) ? messages : []).map((item) => {
    const role = item?.info?.role || "assistant";
    const header = joinBullet$1([
      transcriptRole(role),
      transcriptTime(item?.info?.time?.created)
    ]);
    const body = (Array.isArray(item?.parts) ? item.parts : []).map((part) => formatTranscriptPart(part, role)).filter(Boolean).join("\n\n").trim();
    if (!body) return "";
    return `${header}
${body}`;
  }).filter(Boolean).join("\n\n---\n\n");
}
function interactionRequestText(interaction) {
  const title = typeof interaction?.title === "string" && interaction.title.trim() ? interaction.title.trim() : t("detail.pending_interactions");
  const body = typeof interaction?.body === "string" ? interaction.body.trim() : "";
  return [title, body].filter(Boolean).join("\n\n");
}
function interactionReplyLabel$1(reply) {
  if (reply === "always") return t("interaction.always_allow");
  if (reply === "reject") return t("interaction.reject");
  return t("interaction.allow_once");
}
function interactionAnswerLines$1(interaction) {
  const response = record$2(interaction?.response) ? interaction.response : null;
  const payload = record$2(interaction?.payload) ? interaction.payload : null;
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (Array.isArray(response?.answers)) {
    return response.answers.flatMap((answer, index) => {
      const value = Array.isArray(answer) ? answer.filter(
        (item) => typeof item === "string" && item.trim()
      ).join(", ") : "";
      if (!value) return [];
      const question = record$2(questions[index]) ? questions[index] : null;
      const label = typeof question?.header === "string" && question.header.trim() ? question.header.trim() : typeof question?.question === "string" && question.question.trim() ? question.question.trim() : "";
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  if (record$2(response?.answers)) {
    return Object.entries(response.answers).flatMap(
      ([key, item], index) => {
        const answer = record$2(item) ? item : null;
        const value = Array.isArray(answer?.answers) ? answer.answers.filter(
          (entry) => typeof entry === "string" && entry.trim()
        ).join(", ") : "";
        if (!value) return [];
        const question = record$2(questions[index]) ? questions[index] : null;
        const label = typeof question?.header === "string" && question.header.trim() ? question.header.trim() : typeof question?.question === "string" && question.question.trim() ? question.question.trim() : key;
        return [label ? `- **${label}**: ${value}` : `- ${value}`];
      }
    );
  }
  const message = typeof response?.message === "string" ? response.message.trim() : "";
  return message ? [message] : [];
}
function isAutoReplied(interaction) {
  const response = record$2(interaction?.response) ? interaction.response : null;
  return response?.auto_reply === true;
}
function interactionResponseText(interaction) {
  const auto = isAutoReplied(interaction);
  const prefix = auto ? `[${t("interaction.auto_reply")}] ` : "";
  if (interaction?.type === "permission") {
    if (interaction.status === "rejected") return prefix + t("interaction.reject");
    const response = record$2(interaction?.response) ? interaction.response : null;
    return prefix + interactionReplyLabel$1(
      typeof response?.reply === "string" ? response.reply : "once"
    );
  }
  if (interaction?.status === "rejected") return prefix + t("interaction.skip");
  const answers = interactionAnswerLines$1(interaction);
  if (answers.length > 0) return prefix + answers.join("\n");
  return prefix + t("interaction.answer");
}
async function copyChatConversation() {
  try {
    const transcript = formatConversationTranscript(conversationMessages());
    if (!transcript) return;
    const ok = await copyText$1(transcript);
    if (!ok) throw new Error(t("chat.copy_failed"));
  } catch (e) {
    AppLog.error("ui", "Failed to copy chat conversation", {
      error: String(e)
    });
    await nativeMessage$2(errorText$1("chat.copy_failed", e), {
      title: t("chat.copy_title"),
      kind: "error"
    });
  }
}

function resolveMessage(m) {
  const id = m?.info?.id;
  if (typeof id === "string" && id) {
    const live = messageById(id);
    if (live) return live;
  }
  return m;
}
const _cardResolveCache = /* @__PURE__ */ new Map();
function cardFingerprint(card) {
  const msgs = card._agentMessages || [];
  const children = card._agentInternalCards || [];
  const childMsgCount = children.reduce(
    (acc, c) => acc + (c._agentMessages?.length || 0),
    0
  );
  const steps = (card._agentGoalSteps || []).map((s) => s.status || "").join(",");
  const contractCount = card._agentContracts?.length || 0;
  return `${msgs.length}:${children.length}:${childMsgCount}:${card._agentStatus || ""}:${card._agentGoalStatus || ""}:${steps}:${contractCount}`;
}
const UNTIMED_CONVERSATION_ORDER = Number.MAX_SAFE_INTEGER;
function conversationTime(message) {
  const created = message?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = message?.info?.time?.updated;
  if (Number.isFinite(updated)) return Number(updated);
  return UNTIMED_CONVERSATION_ORDER;
}
function buildUserContextMessages() {
  const board = boardStore.board;
  if (!board) return [];
  const msgs = [];
  const { task } = board;
  if (task?.request) {
    const rawCreated = task.time?.created;
    const taskCreated = Number.isFinite(rawCreated) && rawCreated ? Number(rawCreated) : 0;
    msgs.push({
      _synthetic: true,
      info: { id: "ctx:user-request", role: "user", resolvedRole: "user", channel: "main", time: { created: taskCreated - 2 } },
      parts: [{ type: "text", text: task.request }]
    });
  }
  for (const interaction of Array.isArray(board.interactions) ? board.interactions : []) {
    const isAutoPermission = interaction.type === "permission" && (interaction.status === "answered" || interaction.status === "rejected") && isAutoReplied(interaction);
    if (isAutoPermission) continue;
    const isPlannerClarification = interaction.payload?.planner_clarification === true;
    const interactionRole = isPlannerClarification ? "planner" : "system";
    const rawRequestTime = interaction.time?.created;
    const requestTime = Number.isFinite(rawRequestTime) && rawRequestTime ? Number(rawRequestTime) : Date.now();
    const request = syntheticTextMessage(
      interactionRole,
      requestTime,
      interactionRequestText(interaction)
    );
    if (request) msgs.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const rawResolvedTime = interaction.time?.resolved ?? interaction.time?.updated;
      const resolvedTime = Number.isFinite(rawResolvedTime) && rawResolvedTime ? Number(rawResolvedTime) : Date.now();
      const response = syntheticTextMessage(
        isPlannerClarification ? "user" : "system",
        resolvedTime,
        interactionResponseText(interaction)
      );
      if (response) msgs.push(response);
    }
  }
  return msgs;
}
function conversationMessages() {
  const allMessages = store.messages || [];
  rootTaskSessionID();
  const showTranscriptDetails = store.showTranscriptDetails;
  const mainMessages = [];
  for (const msg of allMessages) {
    const channel = msg.info?.channel || classifyMessage(msg);
    if (channel === "main") {
      mainMessages.push(msg);
    }
  }
  let filteredMain = mainMessages;
  if (!showTranscriptDetails && filteredMain.length > 0) {
    filteredMain = filteredMain.filter((message) => {
      const text = (message.parts || []).map((part) => part.text || "").join("");
      if (text.includes("<assistant-brief>") || text.includes("You are executing a headless coding task")) return false;
      return true;
    });
  }
  const contextMsgs = buildUserContextMessages();
  const agentCardMsgs = [];
  const currentOrder = agentCardOrder();
  const currentCards = agentCards();
  const staleKeys = new Set(_cardResolveCache.keys());
  for (const id of currentOrder) {
    const card = currentCards[id];
    if (!card) continue;
    staleKeys.delete(id);
    const fp = cardFingerprint(card);
    const cached = _cardResolveCache.get(id);
    if (cached && cached.fp === fp) {
      agentCardMsgs.push(cached.resolved);
      continue;
    }
    let resolved;
    if (card._agentGoalGroup && Array.isArray(card._agentInternalCards)) {
      const resolvedChildren = card._agentInternalCards.map((child) => {
        if (!Array.isArray(child._agentMessages)) return child;
        const msgs = child._agentMessages.map((m) => resolveMessage(m));
        msgs.sort((a, b) => conversationTime(a) - conversationTime(b));
        return { ...child, _agentMessages: msgs };
      });
      resolved = { ...card, _agentInternalCards: resolvedChildren };
    } else if (Array.isArray(card._agentMessages) && card._agentMessages.length > 0) {
      const msgs = card._agentMessages.map((m) => resolveMessage(m));
      msgs.sort((a, b) => conversationTime(a) - conversationTime(b));
      resolved = { ...card, _agentMessages: msgs };
    } else {
      continue;
    }
    _cardResolveCache.set(id, { fp, resolved });
    agentCardMsgs.push(resolved);
  }
  for (const key of staleKeys) _cardResolveCache.delete(key);
  const result = [...filteredMain, ...contextMsgs, ...agentCardMsgs].sort(
    (a, b) => conversationTime(a) - conversationTime(b)
  );
  return result;
}

var _tmpl$$p = /* @__PURE__ */ template(`<div class=chat-empty>`);
function Conversation(props) {
  const el = props.container;
  const items = createMemo(() => conversationMessages());
  onMount(() => {
    const cleanup = setupAutoScroll(el);
    onCleanup(cleanup);
  });
  const emptyText = () => t("chat.empty");
  return [createComponent(Show, {
    get when() {
      return items().length === 0;
    },
    get children() {
      var _el$ = _tmpl$$p();
      insert(_el$, emptyText);
      return _el$;
    }
  }), createComponent(Index, {
    get each() {
      return items();
    },
    children: (item) => createComponent(Show, {
      get when() {
        return item()?._agentGoalGroup;
      },
      get fallback() {
        return createComponent(Show, {
          get when() {
            return memo(() => !!item()?._agentCard)() && (item()._agentMessages || []).length > 0;
          },
          get fallback() {
            return createComponent(MessageView, {
              get message() {
                return item();
              }
            });
          },
          get children() {
            return createComponent(AgentCard, {
              get cardID() {
                return item()._agentCardKey;
              },
              get stage() {
                return item()._agentStage;
              },
              get status() {
                return item()._agentStatus;
              },
              get messages() {
                return item()._agentMessages || [];
              },
              get round() {
                return item()._agentRound || 0;
              }
            });
          }
        });
      },
      get children() {
        return createComponent(ExecutorGoalGroup, {
          get cardID() {
            return item()._agentCardKey;
          },
          get goalTitle() {
            return item()._agentGoalTitle;
          },
          get goalDescription() {
            return item()._agentGoalDescription;
          },
          get goalSteps() {
            return item()._agentGoalSteps;
          },
          get contracts() {
            return item()._agentContracts;
          },
          get goalStatus() {
            return item()._agentGoalStatus;
          },
          get status() {
            return item()._agentStatus;
          },
          get internalCards() {
            return item()._agentInternalCards;
          },
          get goalIndex() {
            return item()._agentRound || 0;
          }
        });
      }
    })
  })];
}

var _tmpl$$o = /* @__PURE__ */ template(`<button type=button class=task-row-delete><span class=task-row-delete-icon data-icon=delete aria-hidden=true><svg width=12 height=12 viewBox="0 0 16 16"fill=none><path d="M3.5 4.5h9"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path><path d="M6 4.5V3.6c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v.9"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path><path d="M5.2 6.2l.4 5.4c0 .5.4.9.9.9h2.9c.5 0 .9-.4.9-.9l.4-5.4"stroke=currentColor stroke-width=1.2 stroke-linecap=round>`), _tmpl$2$n = /* @__PURE__ */ template(`<div class="task-row-mini global-task-row"><button type=button class=task-row-main><div class=task-row-head><span class=status-dot aria-hidden=true></span><strong></strong></div><span></span><small>`), _tmpl$3$l = /* @__PURE__ */ template(`<section class=sidebar-list-group><div class=sidebar-list-heading></div><div class=sidebar-list-cluster>`), _tmpl$4$j = /* @__PURE__ */ template(`<div class=task-list-panel>`), _tmpl$5$i = /* @__PURE__ */ template(`<div class=empty-hint>`);
const COMPLETED_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "cancelled"]);
function clipText$1(value, limit = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}
function shortPath$1(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}
function joinBullet(values) {
  return values.filter(Boolean).join(" / ");
}
function taskUpdated(item) {
  return item?.updated_at || item?.task?.time?.updated || item?.task?.time?.created || 0;
}
function taskListTitle(item) {
  return clipText$1(item?.task?.title || item?.overview?.headline || item?.task?.id || "", 72);
}
function statusLabel$1(status) {
  const map = {
    idle: t("task.status.idle"),
    queued: t("task.status.queued"),
    active: t("task.status.active"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled")
  };
  return map[status] || status;
}
function taskListBadge(item, queuePos) {
  if (item?._pending) return statusLabel$1("active");
  const pending = Number(item?.pending_interactions || 0) > 0;
  if (pending) return t("detail.pending_interactions");
  const status = item?.task?.status || "idle";
  if (status === "queued" && queuePos !== void 0 && queuePos > 0) {
    return `${statusLabel$1("queued")} #${queuePos}`;
  }
  return statusLabel$1(status);
}
function taskListMeta(item) {
  return joinBullet([stamp(taskUpdated(item)), shortPath$1(item?.task?.directory || "")]);
}
function DeleteButton(props) {
  return (() => {
    var _el$ = _tmpl$$o();
    _el$.$$click = (e) => {
      e.stopPropagation();
      props.onDelete(props.id);
    };
    createRenderEffect((_p$) => {
      var _v$ = props.id, _v$2 = t("task.delete_button_title"), _v$3 = t("task.delete_button_title");
      _v$ !== _p$.e && setAttribute(_el$, "data-task-delete", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$, "title", _p$.t = _v$2);
      _v$3 !== _p$.a && setAttribute(_el$, "aria-label", _p$.a = _v$3);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$;
  })();
}
function TaskRow(props) {
  const id = () => props.item?.task?.id || "";
  const pending = () => props.item?._pending === true;
  const status = () => pending() ? "active" : props.item?.task?.status || "idle";
  const title = () => taskListTitle(props.item) || id();
  const isActive = () => !pending() && props.selectedTaskID === id();
  return (() => {
    var _el$2 = _tmpl$2$n(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$4.nextSibling, _el$8 = _el$7.nextSibling;
    _el$3.$$click = () => {
      if (!pending() && id()) props.onSelectTask(id());
    };
    insert(_el$6, title);
    insert(_el$7, () => taskListBadge(props.item, props.queuePos));
    insert(_el$8, () => taskListMeta(props.item));
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => !!!!id())() && !!props.onDeleteTask;
      },
      get children() {
        return createComponent(DeleteButton, {
          get id() {
            return id();
          },
          get onDelete() {
            return props.onDeleteTask;
          }
        });
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$4 = isActive() ? "true" : void 0, _v$5 = title(), _v$6 = pending() ? void 0 : id(), _v$7 = pending(), _v$8 = pending() ? "true" : void 0, _v$9 = title(), _v$0 = status();
      _v$4 !== _p$.e && setAttribute(_el$2, "data-active", _p$.e = _v$4);
      _v$5 !== _p$.t && setAttribute(_el$2, "title", _p$.t = _v$5);
      _v$6 !== _p$.a && setAttribute(_el$3, "data-task-id", _p$.a = _v$6);
      _v$7 !== _p$.o && (_el$3.disabled = _p$.o = _v$7);
      _v$8 !== _p$.i && setAttribute(_el$3, "aria-disabled", _p$.i = _v$8);
      _v$9 !== _p$.n && setAttribute(_el$3, "title", _p$.n = _v$9);
      _v$0 !== _p$.s && setAttribute(_el$5, "data-status", _p$.s = _v$0);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0
    });
    return _el$2;
  })();
}
function TaskSection(props) {
  return createComponent(Show, {
    get when() {
      return props.items.length > 0;
    },
    get children() {
      var _el$9 = _tmpl$3$l(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
      insert(_el$0, () => props.label);
      insert(_el$1, createComponent(For, {
        get each() {
          return props.items;
        },
        children: (item) => createComponent(TaskRow, {
          item,
          get selectedTaskID() {
            return props.selectedTaskID;
          },
          get queuePos() {
            return props.queuePositions?.get(item?.task?.id || "");
          },
          get onSelectTask() {
            return props.onSelectTask;
          },
          get onDeleteTask() {
            return props.onDeleteTask;
          }
        })
      }));
      return _el$9;
    }
  });
}
function TaskList(props) {
  const sortedItems = createMemo(() => visibleTasks());
  const activeTasks = createMemo(() => sortedItems().filter((item) => !COMPLETED_STATUSES.has(item?.task?.status || "")));
  const recentTasks = createMemo(() => sortedItems().filter((item) => COMPLETED_STATUSES.has(item?.task?.status || "")));
  const queuePositions = createMemo(() => {
    const PRIORITY_ORDER = {
      high: 0,
      normal: 1,
      low: 2
    };
    const queued = sortedItems().filter((item) => item?.task?.status === "queued" && !item?._pending).sort((a, b) => {
      const pa = PRIORITY_ORDER[a?.task?.priority ?? "normal"] ?? 1;
      const pb = PRIORITY_ORDER[b?.task?.priority ?? "normal"] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a?.task?.time?.created ?? 0) - (b?.task?.time?.created ?? 0);
    });
    const map = /* @__PURE__ */ new Map();
    queued.forEach((item, idx) => {
      const id = item?.task?.id;
      if (id) map.set(id, idx + 1);
    });
    return map;
  });
  const selectedID = () => boardStore.selectedTaskID;
  return (() => {
    var _el$10 = _tmpl$4$j();
    insert(_el$10, createComponent(Show, {
      get when() {
        return sortedItems().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$11 = _tmpl$5$i();
          insert(_el$11, () => t("task.none"));
          return _el$11;
        })();
      },
      get children() {
        return [createComponent(TaskSection, {
          get label() {
            return t("task.group.active");
          },
          get items() {
            return activeTasks();
          },
          get selectedTaskID() {
            return selectedID();
          },
          get queuePositions() {
            return queuePositions();
          },
          get onSelectTask() {
            return props.onSelectTask;
          },
          get onDeleteTask() {
            return props.onDeleteTask;
          }
        }), createComponent(TaskSection, {
          get label() {
            return t("task.group.recent");
          },
          get items() {
            return recentTasks();
          },
          get selectedTaskID() {
            return selectedID();
          },
          get onSelectTask() {
            return props.onSelectTask;
          },
          get onDeleteTask() {
            return props.onDeleteTask;
          }
        })];
      }
    }));
    return _el$10;
  })();
}
delegateEvents(["click"]);

var _tmpl$$n = /* @__PURE__ */ template(`<div class=wf-progress><div class=wf-progress-label></div><div class=wf-progress-steps>`), _tmpl$2$m = /* @__PURE__ */ template(`<span class=wf-step-connector>`), _tmpl$3$k = /* @__PURE__ */ template(`<span><span class=wf-step-icon></span><span class=wf-step-label>`);
function stepStatusClass(status) {
  switch (status) {
    case "completed":
      return "wf-step--done";
    case "running":
      return "wf-step--running";
    case "failed":
      return "wf-step--failed";
    case "skipped":
      return "wf-step--skipped";
    default:
      return "wf-step--pending";
  }
}
function stepStatusIcon(status) {
  switch (status) {
    case "completed":
      return "✓";
    // checkmark
    case "running":
      return "○";
    // circle
    case "failed":
      return "✗";
    // cross
    case "skipped":
      return "—";
    // dash
    default:
      return "·";
  }
}
function WorkflowProgressBar(props) {
  const displaySteps = createMemo(() => {
    const wf = props.workflow;
    if (!wf) return [];
    const goalLoopIDs = new Set(wf.goalLoopStepIDs);
    const result = [];
    let goalGroupAdded = false;
    for (const step of wf.steps) {
      if (goalLoopIDs.has(step.id)) {
        if (!goalGroupAdded) {
          const goalSteps = wf.steps.filter((s) => goalLoopIDs.has(s.id));
          const statuses = goalSteps.map((s) => s.status);
          let aggregateStatus = "pending";
          if (statuses.some((s) => s === "running")) aggregateStatus = "running";
          else if (statuses.every((s) => s === "completed" || s === "skipped")) aggregateStatus = "completed";
          else if (statuses.some((s) => s === "failed")) aggregateStatus = "failed";
          else if (statuses.some((s) => s === "completed")) aggregateStatus = "running";
          result.push({
            id: "goal-loop",
            label: t("workflow.goals_label"),
            status: aggregateStatus,
            isGoalGroup: true
          });
          goalGroupAdded = true;
        }
      } else {
        result.push({
          id: step.id,
          label: step.label,
          status: step.status,
          isGoalGroup: false
        });
      }
    }
    return result;
  });
  return createComponent(Show, {
    get when() {
      return props.workflow;
    },
    get children() {
      var _el$ = _tmpl$$n(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
      insert(_el$2, () => props.workflow.name);
      insert(_el$3, createComponent(For, {
        get each() {
          return displaySteps();
        },
        children: (step, i) => [createComponent(Show, {
          get when() {
            return i() > 0;
          },
          get children() {
            return _tmpl$2$m();
          }
        }), (() => {
          var _el$5 = _tmpl$3$k(), _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling;
          insert(_el$6, () => stepStatusIcon(step.status));
          insert(_el$7, () => step.label);
          createRenderEffect((_p$) => {
            var _v$ = `wf-step ${stepStatusClass(step.status)}`, _v$2 = `${step.label}: ${step.status}`;
            _v$ !== _p$.e && className(_el$5, _p$.e = _v$);
            _v$2 !== _p$.t && setAttribute(_el$5, "title", _p$.t = _v$2);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$5;
        })()]
      }));
      return _el$;
    }
  });
}

var _tmpl$$m = /* @__PURE__ */ template(`<span class=gwg-step-summary>`), _tmpl$2$l = /* @__PURE__ */ template(`<span class=gwg-step-count>(<!>)`), _tmpl$3$j = /* @__PURE__ */ template(`<div class=gwg-plan-nodes>`), _tmpl$4$i = /* @__PURE__ */ template(`<span class=gwg-diff-additions>+`), _tmpl$5$h = /* @__PURE__ */ template(`<span class=gwg-diff-deletions>-`), _tmpl$6$d = /* @__PURE__ */ template(`<div class=gwg-diff-stats><span class=gwg-diff-files> files`), _tmpl$7$b = /* @__PURE__ */ template(`<div class=gwg-changed-files>`), _tmpl$8$9 = /* @__PURE__ */ template(`<div class=gwg-open-session><button type=button class=gwg-open-session-btn>`), _tmpl$9$7 = /* @__PURE__ */ template(`<div>`), _tmpl$0$4 = /* @__PURE__ */ template(`<div class=gwg-eval-summary>`), _tmpl$1$3 = /* @__PURE__ */ template(`<div class=gwg-checks>`), _tmpl$10$3 = /* @__PURE__ */ template(`<div class=gwg-step-messages>`), _tmpl$11$3 = /* @__PURE__ */ template(`<details><summary><span class=gwg-step-icon></span><span class=gwg-step-label></span><span class=gwg-step-status></span></summary><div class=gwg-step-body>`), _tmpl$12$3 = /* @__PURE__ */ template(`<div><span class=gwg-step-icon></span><span class=gwg-step-label></span><span class=gwg-step-status>`), _tmpl$13$3 = /* @__PURE__ */ template(`<div class=gwg-plan-node-brief>`), _tmpl$14$2 = /* @__PURE__ */ template(`<div class=gwg-plan-node><div class=gwg-plan-node-title>`), _tmpl$15$1 = /* @__PURE__ */ template(`<div class=gwg-changed-file>`), _tmpl$16$1 = /* @__PURE__ */ template(`<span class=gwg-check-evidence>`), _tmpl$17 = /* @__PURE__ */ template(`<div><span class=gwg-check-icon></span><span class=gwg-check-name>`), _tmpl$18 = /* @__PURE__ */ template(`<span class=gwg-index>#`), _tmpl$19 = /* @__PURE__ */ template(`<span class=gwg-priority-badge>advisory`), _tmpl$20 = /* @__PURE__ */ template(`<button type=button class="gwg-action-btn gwg-action-edit">✎`), _tmpl$21 = /* @__PURE__ */ template(`<button type=button class="gwg-action-btn gwg-action-delete">✕`), _tmpl$22 = /* @__PURE__ */ template(`<div class=gwg-done-definition><div class=gwg-done-definition-label></div><div class=gwg-done-definition-text>`), _tmpl$23 = /* @__PURE__ */ template(`<div class=gwg-body>`), _tmpl$24 = /* @__PURE__ */ template(`<div><div class=gwg-header role=button tabindex=0><span class=gwg-status-icon></span><span class=gwg-title></span><span class=gwg-id></span><span class=gwg-chevron aria-hidden=true>▼`), _tmpl$25 = /* @__PURE__ */ template(`<div class=gwg-list>`);
function stepIcon(status) {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "○";
    case "failed":
      return "✗";
    case "skipped":
      return "—";
    default:
      return "·";
  }
}
function stepClass(status) {
  switch (status) {
    case "completed":
      return "gwg-step--done";
    case "running":
      return "gwg-step--running";
    case "failed":
      return "gwg-step--failed";
    case "skipped":
      return "gwg-step--skipped";
    default:
      return "gwg-step--pending";
  }
}
function goalStatusIcon(status) {
  switch (status) {
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "running":
      return "○";
    default:
      return "·";
  }
}
function goalStatusClass(status) {
  switch (status) {
    case "passed":
      return "gwg--passed";
    case "failed":
      return "gwg--failed";
    case "running":
      return "gwg--running";
    default:
      return "gwg--pending";
  }
}
function checkStatusIcon(status) {
  if (status === "passed") return "✓";
  if (status === "failed") return "✗";
  return "·";
}
function checkStatusClass(status) {
  if (status === "passed") return "gwg-check--passed";
  if (status === "failed") return "gwg-check--failed";
  return "gwg-check--pending";
}
function verdictClass(verdict) {
  if (verdict === "accepted") return "gwg-verdict--accepted";
  if (verdict === "rejected") return "gwg-verdict--rejected";
  return "gwg-verdict--inconclusive";
}
function StepRow(props) {
  const hasPlanNodes = () => !!props.step.payload?.planNodes && props.step.payload.planNodes.length > 0;
  const hasChangedFiles = () => !!props.step.payload?.changedFiles && props.step.payload.changedFiles.length > 0;
  const hasChecks = () => !!props.step.payload?.checks && props.step.payload.checks.length > 0;
  const hasEvalBody = () => hasChecks() || !!props.step.payload?.evalSummary || !!props.step.payload?.verdict;
  const hasMessages = () => !!props.messages && props.messages.length > 0;
  const hasOpenSession = () => props.step.stepID === "execute" && !!props.step.payload?.executorSessionID && !!props.onOpenSession;
  const hasContent = createMemo(() => hasPlanNodes() || hasChangedFiles() || hasEvalBody() || hasMessages() || hasOpenSession());
  const isActive = () => props.step.status === "running" || props.step.status === "failed";
  return createComponent(Show, {
    get when() {
      return hasContent();
    },
    get fallback() {
      return (() => {
        var _el$25 = _tmpl$12$3(), _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$29 = _el$27.nextSibling;
        insert(_el$26, () => stepIcon(props.step.status));
        insert(_el$27, () => props.step.label);
        insert(_el$25, createComponent(Show, {
          get when() {
            return props.step.summary;
          },
          get children() {
            var _el$28 = _tmpl$$m();
            insert(_el$28, () => props.step.summary);
            return _el$28;
          }
        }), _el$29);
        insert(_el$29, () => props.step.status);
        createRenderEffect(() => className(_el$25, `gwg-step ${stepClass(props.step.status)}`));
        return _el$25;
      })();
    },
    get children() {
      var _el$ = _tmpl$11$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$6 = _el$4.nextSibling, _el$1 = _el$2.nextSibling;
      insert(_el$3, () => stepIcon(props.step.status));
      insert(_el$4, () => props.step.label);
      insert(_el$2, createComponent(Show, {
        get when() {
          return props.step.summary;
        },
        get children() {
          var _el$5 = _tmpl$$m();
          insert(_el$5, () => props.step.summary);
          return _el$5;
        }
      }), _el$6);
      insert(_el$6, () => props.step.status);
      insert(_el$2, createComponent(Show, {
        get when() {
          return hasMessages();
        },
        get children() {
          var _el$7 = _tmpl$2$l(), _el$8 = _el$7.firstChild, _el$0 = _el$8.nextSibling; _el$0.nextSibling;
          insert(_el$7, () => props.messages.length, _el$0);
          return _el$7;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return hasPlanNodes();
        },
        get children() {
          var _el$10 = _tmpl$3$j();
          insert(_el$10, createComponent(For, {
            get each() {
              return props.step.payload.planNodes;
            },
            children: (node) => (() => {
              var _el$30 = _tmpl$14$2(), _el$31 = _el$30.firstChild;
              insert(_el$31, () => node.title);
              insert(_el$30, createComponent(Show, {
                get when() {
                  return node.brief;
                },
                get children() {
                  var _el$32 = _tmpl$13$3();
                  insert(_el$32, () => node.brief);
                  return _el$32;
                }
              }), null);
              return _el$30;
            })()
          }));
          return _el$10;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return hasChangedFiles();
        },
        get children() {
          var _el$11 = _tmpl$7$b();
          insert(_el$11, createComponent(Show, {
            get when() {
              return props.step.payload.diffStats?.files !== void 0;
            },
            get children() {
              var _el$12 = _tmpl$6$d(), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild;
              insert(_el$13, () => props.step.payload.diffStats.files, _el$14);
              insert(_el$12, createComponent(Show, {
                get when() {
                  return props.step.payload.diffStats?.additions !== void 0;
                },
                get children() {
                  var _el$15 = _tmpl$4$i(); _el$15.firstChild;
                  insert(_el$15, () => props.step.payload.diffStats.additions, null);
                  return _el$15;
                }
              }), null);
              insert(_el$12, createComponent(Show, {
                get when() {
                  return props.step.payload.diffStats?.deletions !== void 0;
                },
                get children() {
                  var _el$17 = _tmpl$5$h(); _el$17.firstChild;
                  insert(_el$17, () => props.step.payload.diffStats.deletions, null);
                  return _el$17;
                }
              }), null);
              return _el$12;
            }
          }), null);
          insert(_el$11, createComponent(For, {
            get each() {
              return props.step.payload.changedFiles;
            },
            children: (file) => (() => {
              var _el$33 = _tmpl$15$1();
              insert(_el$33, file);
              return _el$33;
            })()
          }), null);
          return _el$11;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return hasOpenSession();
        },
        get children() {
          var _el$19 = _tmpl$8$9(), _el$20 = _el$19.firstChild;
          _el$20.$$click = (e) => {
            e.stopPropagation();
            props.onOpenSession(props.step.payload.executorSessionID, props.goalTitle ?? "");
          };
          insert(_el$20, () => t("goal.open_session"));
          return _el$19;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return props.step.payload?.verdict;
        },
        get children() {
          var _el$21 = _tmpl$9$7();
          insert(_el$21, () => props.step.payload.verdict);
          createRenderEffect(() => className(_el$21, `gwg-verdict ${verdictClass(props.step.payload.verdict)}`));
          return _el$21;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return props.step.payload?.evalSummary;
        },
        get children() {
          var _el$22 = _tmpl$0$4();
          insert(_el$22, () => props.step.payload.evalSummary);
          return _el$22;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return hasChecks();
        },
        get children() {
          var _el$23 = _tmpl$1$3();
          insert(_el$23, createComponent(For, {
            get each() {
              return props.step.payload.checks;
            },
            children: (check) => (() => {
              var _el$34 = _tmpl$17(), _el$35 = _el$34.firstChild, _el$36 = _el$35.nextSibling;
              insert(_el$35, () => checkStatusIcon(check.status));
              insert(_el$36, () => check.name);
              insert(_el$34, createComponent(Show, {
                get when() {
                  return check.evidence;
                },
                get children() {
                  var _el$37 = _tmpl$16$1();
                  insert(_el$37, () => check.evidence);
                  return _el$37;
                }
              }), null);
              createRenderEffect(() => className(_el$34, `gwg-check ${checkStatusClass(check.status)}`));
              return _el$34;
            })()
          }));
          return _el$23;
        }
      }), null);
      insert(_el$1, createComponent(Show, {
        get when() {
          return hasMessages();
        },
        get children() {
          var _el$24 = _tmpl$10$3();
          insert(_el$24, createComponent(For, {
            get each() {
              return props.messages;
            },
            children: (msg) => createComponent(MessageView, {
              message: msg
            })
          }));
          return _el$24;
        }
      }), null);
      createRenderEffect((_p$) => {
        var _v$ = `gwg-step-detail ${stepClass(props.step.status)}`, _v$2 = isActive(), _v$3 = `gwg-step ${stepClass(props.step.status)}`;
        _v$ !== _p$.e && className(_el$, _p$.e = _v$);
        _v$2 !== _p$.t && (_el$.open = _p$.t = _v$2);
        _v$3 !== _p$.a && className(_el$2, _p$.a = _v$3);
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0
      });
      return _el$;
    }
  });
}
function GoalWorkflowGroup(props) {
  const active = () => props.goal.goalStatus === "running" || props.goal.goalStatus === "failed";
  const cardKey = () => `gwg:${props.goal.goalID}`;
  const expanded = () => props.defaultOpen ?? agentCardExpanded(cardKey(), active());
  const toggle = () => toggleAgentCardExpanded(cardKey(), active());
  return (() => {
    var _el$38 = _tmpl$24(), _el$39 = _el$38.firstChild, _el$40 = _el$39.firstChild, _el$43 = _el$40.nextSibling, _el$44 = _el$43.nextSibling, _el$48 = _el$44.nextSibling;
    _el$39.$$keydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    _el$39.$$click = toggle;
    insert(_el$40, () => goalStatusIcon(props.goal.goalStatus));
    insert(_el$39, createComponent(Show, {
      get when() {
        return props.goalIndex !== void 0;
      },
      get children() {
        var _el$41 = _tmpl$18(); _el$41.firstChild;
        insert(_el$41, () => props.goalIndex, null);
        return _el$41;
      }
    }), _el$43);
    insert(_el$43, () => props.goal.goalTitle);
    _el$44.$$click = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(props.goal.goalID).catch(() => {
      });
    };
    insert(_el$44, () => props.goal.goalID.slice(-8));
    insert(_el$39, createComponent(Show, {
      get when() {
        return props.goal.priority === "advisory";
      },
      get children() {
        return _tmpl$19();
      }
    }), _el$48);
    insert(_el$39, createComponent(Show, {
      get when() {
        return props.onEditGoal;
      },
      get children() {
        var _el$46 = _tmpl$20();
        _el$46.$$click = (e) => {
          e.stopPropagation();
          props.onEditGoal(props.goal.goalID, props.goal.goalTitle, props.goal.doneDefinition ?? "");
        };
        createRenderEffect(() => setAttribute(_el$46, "title", t("goal.edit_button_title")));
        return _el$46;
      }
    }), _el$48);
    insert(_el$39, createComponent(Show, {
      get when() {
        return props.onDeleteGoal;
      },
      get children() {
        var _el$47 = _tmpl$21();
        _el$47.$$click = (e) => {
          e.stopPropagation();
          props.onDeleteGoal(props.goal.goalID);
        };
        createRenderEffect(() => setAttribute(_el$47, "title", t("goal.delete_button_title")));
        return _el$47;
      }
    }), _el$48);
    insert(_el$38, createComponent(Show, {
      get when() {
        return expanded();
      },
      get children() {
        var _el$49 = _tmpl$23();
        insert(_el$49, createComponent(Show, {
          get when() {
            return props.goal.doneDefinition;
          },
          get children() {
            var _el$50 = _tmpl$22(), _el$51 = _el$50.firstChild, _el$52 = _el$51.nextSibling;
            insert(_el$51, () => t("goal.field.done_definition"));
            insert(_el$52, () => props.goal.doneDefinition);
            return _el$50;
          }
        }), null);
        insert(_el$49, createComponent(For, {
          get each() {
            return props.goal.steps;
          },
          children: (step) => createComponent(StepRow, {
            step,
            get messages() {
              return props.stepMessages?.[step.stepID];
            },
            get goalTitle() {
              return props.goal.goalTitle;
            },
            get onOpenSession() {
              return props.onOpenSession;
            }
          })
        }), null);
        return _el$49;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$4 = `gwg ${goalStatusClass(props.goal.goalStatus)}`, _v$5 = !!expanded(), _v$6 = expanded(), _v$7 = props.goal.goalID;
      _v$4 !== _p$.e && className(_el$38, _p$.e = _v$4);
      _v$5 !== _p$.t && _el$38.classList.toggle("gwg--expanded", _p$.t = _v$5);
      _v$6 !== _p$.a && setAttribute(_el$39, "aria-expanded", _p$.a = _v$6);
      _v$7 !== _p$.o && setAttribute(_el$44, "title", _p$.o = _v$7);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    return _el$38;
  })();
}
function GoalWorkflowList(props) {
  return (() => {
    var _el$53 = _tmpl$25();
    insert(_el$53, createComponent(For, {
      get each() {
        return props.goals;
      },
      children: (goal, idx) => createComponent(GoalWorkflowGroup, {
        goal,
        get goalIndex() {
          return idx() + 1;
        },
        get stepMessages() {
          return props.goalStepMessages?.[goal.goalID];
        },
        get onOpenSession() {
          return props.onOpenSession;
        },
        get onEditGoal() {
          return props.onEditGoal;
        },
        get onDeleteGoal() {
          return props.onDeleteGoal;
        }
      })
    }));
    return _el$53;
  })();
}
delegateEvents(["click", "keydown"]);

var _tmpl$$l = /* @__PURE__ */ template(`<div class=req-streaming><div class=req-streaming-indicator><span class=agent-card-spinner></span><span class=req-streaming-label></span></div><div class=req-streaming-messages>`), _tmpl$2$k = /* @__PURE__ */ template(`<div class=req-list>`), _tmpl$3$i = /* @__PURE__ */ template(`<p class=req-empty>`), _tmpl$4$h = /* @__PURE__ */ template(`<details class=req-spec-detail><summary></summary><pre class=req-spec-content>`), _tmpl$5$g = /* @__PURE__ */ template(`<div class=req-panel>`), _tmpl$6$c = /* @__PURE__ */ template(`<span class=req-priority>advisory`), _tmpl$7$a = /* @__PURE__ */ template(`<div class=req-item><span class=req-id></span><span></span><span class=req-desc>`);
function typeBadgeClass(type) {
  switch (type) {
    case "explicit":
      return "req-type--explicit";
    case "inferred":
      return "req-type--inferred";
    case "system":
      return "req-type--system";
    default:
      return "";
  }
}
function RequirementsPanel(props) {
  const hasData = () => props.requirements && props.requirements.length > 0;
  const hasStream = () => props.streamingMessages && props.streamingMessages.length > 0;
  return (() => {
    var _el$ = _tmpl$5$g();
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!(props.isGenerating && hasStream()))() && !hasData();
      },
      get children() {
        var _el$2 = _tmpl$$l(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling;
        insert(_el$5, () => t("workflow.requirements_generating"));
        insert(_el$6, createComponent(For, {
          get each() {
            return props.streamingMessages;
          },
          children: (msg) => createComponent(MessageView, {
            message: msg
          })
        }));
        return _el$2;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return hasData();
      },
      get children() {
        var _el$7 = _tmpl$2$k();
        insert(_el$7, createComponent(For, {
          get each() {
            return props.requirements;
          },
          children: (req) => (() => {
            var _el$10 = _tmpl$7$a(), _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$12.nextSibling;
            insert(_el$11, () => req.id);
            insert(_el$12, () => req.type);
            insert(_el$13, () => req.description);
            insert(_el$10, createComponent(Show, {
              get when() {
                return req.priority === "advisory";
              },
              get children() {
                return _tmpl$6$c();
              }
            }), null);
            createRenderEffect(() => className(_el$12, `req-type ${typeBadgeClass(req.type)}`));
            return _el$10;
          })()
        }));
        return _el$7;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!!hasData())() && !props.isGenerating;
      },
      get children() {
        var _el$8 = _tmpl$3$i();
        insert(_el$8, () => t("workflow.requirements_pending"));
        return _el$8;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return props.specContent;
      },
      get children() {
        var _el$9 = _tmpl$4$h(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
        insert(_el$0, () => t("workflow.spec_detail"));
        insert(_el$1, () => props.specContent);
        return _el$9;
      }
    }), null);
    return _el$;
  })();
}

var _tmpl$$k = /* @__PURE__ */ template(`<div class=arch-generating><span class=agent-card-spinner></span><span class=arch-generating-label>`), _tmpl$2$j = /* @__PURE__ */ template(`<div class=arch-summary><span class=arch-count></span><span class=arch-count-label>`), _tmpl$3$h = /* @__PURE__ */ template(`<div class=arch-categories>`), _tmpl$4$g = /* @__PURE__ */ template(`<div class="arch-detail md-content">`), _tmpl$5$f = /* @__PURE__ */ template(`<div class=arch-panel>`), _tmpl$6$b = /* @__PURE__ */ template(`<span class=arch-cat-badge>`);
function ArchitectPanel(props) {
  return (() => {
    var _el$ = _tmpl$5$f();
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!props.isGenerating)() && !props.architect;
      },
      get children() {
        var _el$2 = _tmpl$$k(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling;
        insert(_el$4, () => t("workflow.architect_generating"));
        return _el$2;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return props.architect;
      },
      get children() {
        return [(() => {
          var _el$5 = _tmpl$2$j(), _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling;
          insert(_el$6, () => props.architect.contractCount);
          insert(_el$7, () => t("workflow.architect_contracts"));
          return _el$5;
        })(), createComponent(Show, {
          get when() {
            return props.architect.categories.length > 0;
          },
          get children() {
            var _el$8 = _tmpl$3$h();
            insert(_el$8, createComponent(For, {
              get each() {
                return props.architect.categories;
              },
              children: (cat) => (() => {
                var _el$0 = _tmpl$6$b();
                setAttribute(_el$0, "title", cat);
                insert(_el$0, () => cat.replace(/_/g, " "));
                return _el$0;
              })()
            }));
            return _el$8;
          }
        }), createComponent(Show, {
          get when() {
            return props.architect.summary;
          },
          get children() {
            var _el$9 = _tmpl$4$g();
            createRenderEffect(() => _el$9.innerHTML = renderMarkdown(props.architect.summary));
            return _el$9;
          }
        })];
      }
    }), null);
    return _el$;
  })();
}

var _tmpl$2$i = /* @__PURE__ */ template(`<div class=delivery-files>`), _tmpl$3$g = /* @__PURE__ */ template(`<div class=delivery-card><div class=delivery-title></div><div class="delivery-summary md-content">`), _tmpl$4$f = /* @__PURE__ */ template(`<p class=empty-hint>`), _tmpl$5$e = /* @__PURE__ */ template(`<button type=button class="btn btn-primary"data-task-action=retry>`), _tmpl$6$a = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost"data-task-action=replan>`), _tmpl$7$9 = /* @__PURE__ */ template(`<div class=task-actions-buttons>`), _tmpl$8$8 = /* @__PURE__ */ template(`<div class=task-actions-bar>`), _tmpl$9$6 = /* @__PURE__ */ template(`<button class="btn btn-primary"data-action=always>`), _tmpl$0$3 = /* @__PURE__ */ template(`<button class="btn btn-ghost"data-action=once>`), _tmpl$1$2 = /* @__PURE__ */ template(`<button class="btn btn-ghost"data-action=reject>`), _tmpl$10$2 = /* @__PURE__ */ template(`<div class=interaction-alert><div class=interaction-title> </div><div class="interaction-body md-content"></div><div class=interaction-actions>`), _tmpl$11$2 = /* @__PURE__ */ template(`<button class="btn btn-primary"data-action=answer>`), _tmpl$12$2 = /* @__PURE__ */ template(`<div class=interactions-list>`), _tmpl$13$2 = /* @__PURE__ */ template(`<details class=section><summary class=section-head><span class=section-icon aria-hidden=true></span><span class=section-title></span><span class=section-badge></span></summary><div class=section-body>`), _tmpl$14$1 = /* @__PURE__ */ template(`<div id=taskActionsBar>`);
function statusIcon(status) {
  const activeIcon = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M6 4.6L11.3 8 6 11.4Z"/></svg>`;
  const map = {
    idle: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><circle data-fill="true" cx="8" cy="8" r="1.25"/></svg>`,
    queued: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M8 5.4v2.8l2.1 1.3"/></svg>`,
    active: activeIcon,
    completed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.1 8.2l2 2 3.8-3.8"/></svg>`,
    failed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.4 5.4l5.2 5.2"/><path data-stroke="true" d="M10.6 5.4l-5.2 5.2"/></svg>`,
    cancelled: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.2 10.8l5.6-5.6"/></svg>`
  };
  return map[status] || map.idle;
}
function deliveryStatusLabel(status) {
  if (status === "delivered") return t("delivery.status.delivered");
  if (status === "publishing") return t("delivery.status.publishing");
  if (status === "failed") return t("delivery.status.failed");
  return t("delivery.status.candidate");
}
function DeliveryPanel(props) {
  return createComponent(Show, {
    get when() {
      return props.delivery;
    },
    get fallback() {
      return (() => {
        var _el$8 = _tmpl$4$f();
        insert(_el$8, () => t("empty.delivery"));
        return _el$8;
      })();
    },
    get children() {
      var _el$4 = _tmpl$3$g(), _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling;
      insert(_el$5, () => deliveryStatusLabel(props.delivery?.status));
      insert(_el$4, createComponent(Show, {
        get when() {
          return props.delivery?.result?.changedFiles?.length > 0;
        },
        get children() {
          var _el$7 = _tmpl$2$i();
          insert(_el$7, () => tc("delivery.files_changed", props.delivery.result.changedFiles.length, {
            count: props.delivery.result.changedFiles.length
          }));
          return _el$7;
        }
      }), null);
      createRenderEffect(() => _el$6.innerHTML = renderMarkdown(props.delivery?.summary || props.delivery?.result?.summary || ""));
      return _el$4;
    }
  });
}
function TaskActionsPanel(props) {
  const controls = createMemo(() => props.overview?.controls || {});
  const hasButtons = createMemo(() => controls().canRetry || controls().canReplan);
  const visible = createMemo(() => hasButtons());
  return createComponent(Show, {
    get when() {
      return visible();
    },
    get children() {
      var _el$9 = _tmpl$8$8();
      insert(_el$9, createComponent(Show, {
        get when() {
          return hasButtons();
        },
        get children() {
          var _el$0 = _tmpl$7$9();
          insert(_el$0, createComponent(Show, {
            get when() {
              return controls().canRetry;
            },
            get children() {
              var _el$1 = _tmpl$5$e();
              _el$1.$$click = () => props.onRetry?.();
              insert(_el$1, () => t("task.action.retry"));
              createRenderEffect((_p$) => {
                var _v$4 = t("task.action.retry_title"), _v$5 = t("task.action.retry_title");
                _v$4 !== _p$.e && setAttribute(_el$1, "title", _p$.e = _v$4);
                _v$5 !== _p$.t && setAttribute(_el$1, "aria-label", _p$.t = _v$5);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$1;
            }
          }), null);
          insert(_el$0, createComponent(Show, {
            get when() {
              return controls().canReplan;
            },
            get children() {
              var _el$10 = _tmpl$6$a();
              _el$10.$$click = () => props.onReplan?.();
              insert(_el$10, () => t("task.action.replan"));
              createRenderEffect((_p$) => {
                var _v$6 = t("task.action.replan_title"), _v$7 = t("task.action.replan_title");
                _v$6 !== _p$.e && setAttribute(_el$10, "title", _p$.e = _v$6);
                _v$7 !== _p$.t && setAttribute(_el$10, "aria-label", _p$.t = _v$7);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$10;
            }
          }), null);
          return _el$0;
        }
      }));
      return _el$9;
    }
  });
}
function interactionIcon$1(interaction) {
  return interaction.type === "permission" ? "🔒" : "❓";
}
function InteractionAlert(props) {
  const icon = () => interactionIcon$1(props.interaction);
  return (() => {
    var _el$11 = _tmpl$10$2(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$12.nextSibling, _el$15 = _el$14.nextSibling;
    insert(_el$12, icon, _el$13);
    insert(_el$12, () => props.interaction.title, null);
    insert(_el$15, createComponent(Show, {
      get when() {
        return props.interaction.type === "permission";
      },
      get fallback() {
        return [(() => {
          var _el$19 = _tmpl$11$2();
          _el$19.$$click = () => props.onResolve?.(props.interaction.id, "answer");
          insert(_el$19, () => t("interaction.answer"));
          createRenderEffect((_p$) => {
            var _v$14 = t("interaction.answer_title"), _v$15 = t("interaction.answer_title");
            _v$14 !== _p$.e && setAttribute(_el$19, "title", _p$.e = _v$14);
            _v$15 !== _p$.t && setAttribute(_el$19, "aria-label", _p$.t = _v$15);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$19;
        })(), (() => {
          var _el$20 = _tmpl$1$2();
          _el$20.$$click = () => props.onReject?.(props.interaction.id);
          insert(_el$20, () => t("interaction.skip"));
          createRenderEffect((_p$) => {
            var _v$16 = t("interaction.skip_title"), _v$17 = t("interaction.skip_title");
            _v$16 !== _p$.e && setAttribute(_el$20, "title", _p$.e = _v$16);
            _v$17 !== _p$.t && setAttribute(_el$20, "aria-label", _p$.t = _v$17);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$20;
        })()];
      },
      get children() {
        return [(() => {
          var _el$16 = _tmpl$9$6();
          _el$16.$$click = () => props.onResolve?.(props.interaction.id, "always");
          insert(_el$16, () => t("interaction.always_allow"));
          createRenderEffect((_p$) => {
            var _v$8 = t("interaction.always_allow_title"), _v$9 = t("interaction.always_allow_title");
            _v$8 !== _p$.e && setAttribute(_el$16, "title", _p$.e = _v$8);
            _v$9 !== _p$.t && setAttribute(_el$16, "aria-label", _p$.t = _v$9);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$16;
        })(), (() => {
          var _el$17 = _tmpl$0$3();
          _el$17.$$click = () => props.onResolve?.(props.interaction.id, "once");
          insert(_el$17, () => t("interaction.allow_once"));
          createRenderEffect((_p$) => {
            var _v$0 = t("interaction.allow_once_title"), _v$1 = t("interaction.allow_once_title");
            _v$0 !== _p$.e && setAttribute(_el$17, "title", _p$.e = _v$0);
            _v$1 !== _p$.t && setAttribute(_el$17, "aria-label", _p$.t = _v$1);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$17;
        })(), (() => {
          var _el$18 = _tmpl$1$2();
          _el$18.$$click = () => props.onReject?.(props.interaction.id);
          insert(_el$18, () => t("interaction.reject"));
          createRenderEffect((_p$) => {
            var _v$10 = t("interaction.reject_title"), _v$11 = t("interaction.reject_title");
            _v$10 !== _p$.e && setAttribute(_el$18, "title", _p$.e = _v$10);
            _v$11 !== _p$.t && setAttribute(_el$18, "aria-label", _p$.t = _v$11);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$18;
        })()];
      }
    }));
    createRenderEffect((_p$) => {
      var _v$12 = props.interaction.id, _v$13 = renderMarkdown(props.interaction.body || "");
      _v$12 !== _p$.e && setAttribute(_el$11, "data-id", _p$.e = _v$12);
      _v$13 !== _p$.t && (_el$14.innerHTML = _p$.t = _v$13);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$11;
  })();
}
function InteractionsList(props) {
  const pending = createMemo(() => (props.interactions || []).filter((item) => item.status === "pending"));
  return createComponent(Show, {
    get when() {
      return pending().length > 0;
    },
    get children() {
      var _el$21 = _tmpl$12$2();
      insert(_el$21, createComponent(For, {
        get each() {
          return pending();
        },
        children: (interaction) => createComponent(InteractionAlert, {
          interaction,
          get onResolve() {
            return props.onResolve;
          },
          get onReject() {
            return props.onReject;
          }
        })
      }));
      return _el$21;
    }
  });
}
const SECTION_ICONS = {
  spec: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5L9.5 2Z"/><polyline points="9.5,2 9.5,4.5 12,4.5"/><line x1="6" y1="7" x2="10" y2="7"/><line x1="6" y1="9.5" x2="10" y2="9.5"/></svg>`,
  plan: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="4" x2="13" y2="4"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="6" y1="12" x2="13" y2="12"/><circle cx="3.5" cy="4" r="0.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="8" r="0.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>`,
  goals: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none"/></svg>`,
  criteria: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.2"/><path d="M6 6l1.2 1.2L9.5 5"/><line x1="6" y1="9.5" x2="10" y2="9.5"/><line x1="6" y1="11.5" x2="9" y2="11.5"/></svg>`,
  delivery: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3Z"/><polyline points="2.5,5.5 8,8.5 13.5,5.5"/><line x1="8" y1="8.5" x2="8" y2="13.5"/></svg>`};
function SectionFrame(props) {
  return (() => {
    var _el$22 = _tmpl$13$2(), _el$23 = _el$22.firstChild, _el$24 = _el$23.firstChild, _el$25 = _el$24.nextSibling, _el$26 = _el$25.nextSibling, _el$27 = _el$23.nextSibling;
    insert(_el$25, () => props.title);
    insert(_el$26, () => props.badgeText || "");
    insert(_el$27, () => props.children);
    createRenderEffect((_p$) => {
      var _v$18 = props.id, _v$19 = props.icon || "", _v$20 = props.badgeId, _v$21 = props.badgeTone, _v$22 = props.bodyId;
      _v$18 !== _p$.e && setAttribute(_el$22, "id", _p$.e = _v$18);
      _v$19 !== _p$.t && (_el$24.innerHTML = _p$.t = _v$19);
      _v$20 !== _p$.a && setAttribute(_el$26, "id", _p$.a = _v$20);
      _v$21 !== _p$.o && setAttribute(_el$26, "data-tone", _p$.o = _v$21);
      _v$22 !== _p$.i && setAttribute(_el$27, "id", _p$.i = _v$22);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    return _el$22;
  })();
}
function Board(props) {
  const board = () => boardStore.board;
  const spec = () => board()?.spec;
  const delivery = () => board()?.delivery;
  const interactions = () => board()?.interactions || [];
  const overview = () => board()?.overview;
  const goalsCards = createMemo(() => {
    const lanes = board()?.lanes || [];
    const goalsLane = lanes.find((l) => l.id === "goals");
    return goalsLane?.cards || [];
  });
  createMemo(() => {
    const goalRuns = board()?.goalRuns || [];
    return new Set(goalRuns.filter((gr) => gr.status === "running" || gr.status === "accepted").map((gr) => gr.goalID).filter(Boolean));
  });
  const workflow = () => board()?.workflow;
  const requirements = () => board()?.requirements;
  const architect = () => board()?.architect;
  const goalWorkflows = () => board()?.goalWorkflows || [];
  const isRequirementsGenerating = createMemo(() => {
    const wf = workflow();
    if (!wf) return false;
    const reqStep = wf.steps.find((s) => s.id === "requirements");
    return reqStep?.status === "running";
  });
  const isArchitectGenerating = createMemo(() => {
    const wf = workflow();
    if (!wf) return false;
    const archStep = wf.steps.find((s) => s.id === "architect");
    return archStep?.status === "running";
  });
  const requirementsMessages = createMemo(() => {
    const cards = agentCards();
    const order = agentCardOrder();
    const msgs = [];
    for (const cardID of order) {
      const card = cards[cardID];
      if (!card) continue;
      const stage = card._agentStage || "";
      if (stage === "spec" || stage === "goal") {
        const m = Array.isArray(card._agentMessages) ? card._agentMessages : [];
        msgs.push(...m);
      }
    }
    return msgs;
  });
  const STAGE_TO_STEP = {
    planner: "plan",
    executor: "execute",
    evaluator: "eval"
  };
  const goalStepMessages = createMemo(() => {
    const cards = agentCards();
    const order = agentCardOrder();
    const result = {};
    for (const cardID of order) {
      const card = cards[cardID];
      if (!card) continue;
      const stage = card._agentStage || "";
      const stepID = STAGE_TO_STEP[stage];
      if (!stepID) continue;
      const goalID = card._agentGoalID;
      if (!goalID) continue;
      if (!result[goalID]) result[goalID] = {};
      if (!result[goalID][stepID]) result[goalID][stepID] = [];
      const msgs = Array.isArray(card._agentMessages) ? card._agentMessages : [];
      result[goalID][stepID].push(...msgs);
    }
    return result;
  });
  const showWorkflowProgress = createMemo(() => !!workflow());
  const showRequirements = createMemo(() => !!requirements() || !!spec() || isRequirementsGenerating() || requirementsMessages().length > 0);
  const showArchitect = createMemo(() => !!architect() || isArchitectGenerating());
  const showGoals = createMemo(() => goalWorkflows().length > 0 || goalsCards().length > 0);
  const showDelivery = createMemo(() => !!delivery());
  const showInteractions = createMemo(() => interactions().some((i) => i.status === "pending"));
  return [(() => {
    var _el$28 = _tmpl$14$1();
    insert(_el$28, createComponent(TaskActionsPanel, {
      get overview() {
        return overview();
      },
      get onRetry() {
        return props.onRetry;
      },
      get onReplan() {
        return props.onReplan;
      },
      get onCancel() {
        return props.onCancel;
      }
    }));
    return _el$28;
  })(), createComponent(Show, {
    get when() {
      return showWorkflowProgress();
    },
    get children() {
      return createComponent(WorkflowProgressBar, {
        get workflow() {
          return workflow();
        }
      });
    }
  }), createComponent(Show, {
    get when() {
      return showRequirements();
    },
    get children() {
      return createComponent(SectionFrame, {
        id: "requirementsSection",
        get title() {
          return t("workflow.requirements");
        },
        get icon() {
          return SECTION_ICONS.spec;
        },
        bodyId: "requirementsBody",
        badgeId: "requirementsBadge",
        get badgeText() {
          return memo(() => !!requirements()?.length)() ? String(requirements().length) : memo(() => !!isRequirementsGenerating())() ? t("common.active") : "";
        },
        get badgeTone() {
          return requirements()?.length || isRequirementsGenerating() ? "accent" : "";
        },
        get children() {
          return createComponent(RequirementsPanel, {
            get requirements() {
              return requirements();
            },
            get specContent() {
              return spec()?.content;
            },
            get isGenerating() {
              return isRequirementsGenerating();
            },
            get streamingMessages() {
              return requirementsMessages();
            }
          });
        }
      });
    }
  }), createComponent(Show, {
    get when() {
      return showArchitect();
    },
    get children() {
      return createComponent(SectionFrame, {
        id: "architectSection",
        get title() {
          return t("workflow.architect");
        },
        get icon() {
          return SECTION_ICONS.plan;
        },
        bodyId: "architectBody",
        badgeId: "architectBadge",
        get badgeText() {
          return memo(() => !!architect())() ? String(architect().contractCount) : "";
        },
        get badgeTone() {
          return architect() ? "accent" : "";
        },
        get children() {
          return createComponent(ArchitectPanel, {
            get architect() {
              return architect();
            },
            get isGenerating() {
              return isArchitectGenerating();
            }
          });
        }
      });
    }
  }), createComponent(Show, {
    get when() {
      return showGoals();
    },
    get children() {
      return createComponent(SectionFrame, {
        id: "goalWorkflowsSection",
        get title() {
          return t("workflow.goals");
        },
        get icon() {
          return SECTION_ICONS.goals;
        },
        bodyId: "goalWorkflowsBody",
        badgeId: "goalWorkflowsBadge",
        get badgeText() {
          const gw = goalWorkflows();
          const passed = gw.filter((g) => g.goalStatus === "passed").length;
          return gw.length > 0 ? `${passed}/${gw.length}` : "";
        },
        get badgeTone() {
          const gw = goalWorkflows();
          if (gw.length === 0) return "";
          const passed = gw.filter((g) => g.goalStatus === "passed").length;
          return passed === gw.length ? "good" : gw.some((g) => g.goalStatus === "failed") ? "bad" : "accent";
        },
        get children() {
          return createComponent(GoalWorkflowList, {
            get goals() {
              return goalWorkflows();
            },
            get goalStepMessages() {
              return goalStepMessages();
            },
            get onOpenSession() {
              return props.onOpenSession;
            },
            get onEditGoal() {
              return props.onEditGoal;
            },
            get onDeleteGoal() {
              return props.onDeleteGoal;
            }
          });
        }
      });
    }
  }), createComponent(Show, {
    get when() {
      return showDelivery();
    },
    get children() {
      return createComponent(SectionFrame, {
        id: "deliverySection",
        get title() {
          return t("section.delivery");
        },
        get icon() {
          return SECTION_ICONS.delivery;
        },
        bodyId: "deliveryBody",
        badgeId: "deliveryBadge",
        get badgeText() {
          return memo(() => !!delivery())() ? deliveryStatusLabel(delivery()?.status) : "";
        },
        get badgeTone() {
          return memo(() => delivery()?.status === "delivered")() ? "good" : memo(() => delivery()?.status === "failed")() ? "bad" : delivery() ? "accent" : "";
        },
        get children() {
          return createComponent(DeliveryPanel, {
            get delivery() {
              return delivery();
            }
          });
        }
      });
    }
  }), createComponent(Show, {
    get when() {
      return showInteractions();
    },
    get children() {
      return createComponent(SectionFrame, {
        id: "interactionsSection",
        get title() {
          return t("workflow.interactions");
        },
        get icon() {
          return SECTION_ICONS.criteria;
        },
        bodyId: "interactionsBody",
        badgeId: "interactionsBadge",
        get badgeText() {
          return String(interactions().filter((i) => i.status === "pending").length);
        },
        badgeTone: "warn",
        get children() {
          return createComponent(InteractionsList, {
            get interactions() {
              return interactions();
            },
            get onResolve() {
              return props.onResolveInteraction;
            },
            get onReject() {
              return props.onRejectInteraction;
            }
          });
        }
      });
    }
  })];
}
delegateEvents(["click"]);

var _tmpl$$j = /* @__PURE__ */ template(`<div class=chat-attachments id=chatAttachments>`), _tmpl$2$h = /* @__PURE__ */ template(`<svg width=14 height=14 viewBox="0 0 16 16"fill=none aria-hidden=true><path d="M4 6l4 4 4-4"stroke=currentColor stroke-width=1.3 stroke-linecap=round stroke-linejoin=round>`), _tmpl$3$f = /* @__PURE__ */ template(`<svg width=16 height=16 viewBox="0 0 16 16"fill=none><rect x=4.25 y=4.25 width=7.5 height=7.5 rx=1.2 fill=currentColor>`), _tmpl$4$e = /* @__PURE__ */ template(`<form id=chatForm class=chat-input><input id=chatFileInput type=file multiple hidden><div class=chat-compose-row><textarea id=chatTextarea class=chat-textarea rows=2></textarea><div class=chat-icon-col><button type=button id=btnChatAttach class=chat-toolbar-btn><svg width=14 height=14 viewBox="0 0 16 16"fill=none aria-hidden=true><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5L9 3a2 2 0 012.8 2.8L6 11.6a.8.8 0 01-1.1-1.1L10.5 5"stroke=currentColor stroke-width=1.2 stroke-linecap=round stroke-linejoin=round></path></svg></button><button type=button id=btnWebSearch class=chat-toolbar-btn><svg width=14 height=14 viewBox="0 0 16 16"fill=none aria-hidden=true><circle cx=8 cy=8 r=6.5 stroke=currentColor stroke-width=1.2></circle><path d="M8 1.5C8 1.5 5.5 4.5 5.5 8S8 14.5 8 14.5M8 1.5C8 1.5 10.5 4.5 10.5 8S8 14.5 8 14.5"stroke=currentColor stroke-width=1.2 stroke-linecap=round stroke-linejoin=round></path><path d="M1.5 8h13"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></button><button type=button class=chat-toolbar-btn></button></div><button><span class=chat-send-icon aria-hidden=true></span><span class=chat-send-label></span></button></div><div class=chat-compose-meta><div class=chat-compose-meta-left><span class=chat-version id=chatVersion></span><span class=chat-author>杨恒@代码生成组</span></div><div class=chat-compose-tip>`), _tmpl$5$d = /* @__PURE__ */ template(`<img class=chat-attachment-thumb>`), _tmpl$6$9 = /* @__PURE__ */ template(`<div class=chat-attachment-item><span class=chat-attachment-name></span><button type=button class=chat-attachment-remove aria-label=Remove>&times;`), _tmpl$7$8 = /* @__PURE__ */ template(`<span class=chat-attachment-icon>`), _tmpl$8$7 = /* @__PURE__ */ template(`<svg width=14 height=14 viewBox="0 0 16 16"fill=none aria-hidden=true><path d="M4 10l4-4 4 4"stroke=currentColor stroke-width=1.3 stroke-linecap=round stroke-linejoin=round>`), _tmpl$9$5 = /* @__PURE__ */ template(`<svg width=16 height=16 viewBox="0 0 16 16"fill=none><path d="M2 8l10-5-3 5 3 5z"fill=currentColor>`);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const FILE_ACCEPT = ["image/*", ".pdf", ".txt", ".md", ".json", ".csv", ".xml", ".yaml", ".yml", ".log", ".ts", ".js", ".py", ".go", ".rs", ".c", ".cpp", ".h", ".java", ".rb", ".sh", ".bat", ".ps1", ".html", ".css", ".sql", ".toml"].join(",");
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function ChatComposer(props) {
  let textareaRef;
  let fileInputRef;
  let formRef;
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal([]);
  const [dragover, setDragover] = createSignal(false);
  const [webSearch, setWebSearch] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const hasText = createMemo(() => text().trim().length > 0);
  const stopping = () => props.stopping === true;
  async function addAttachment(file) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      console.warn("[ChatComposer] file too large:", file.name, file.size);
      return;
    }
    const url = await fileToDataUrl(file);
    setAttachments((prev) => [...prev, {
      mime: file.type || "application/octet-stream",
      url,
      filename: file.name
    }]);
  }
  function removeAttachment(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }
  function handleSubmit(e) {
    e.preventDefault();
    if (props.busy) return;
    if (!props.enabled) return;
    const trimmed = text().trim();
    if (!trimmed) return;
    const sentAttachments = [...attachments()];
    setText("");
    setAttachments([]);
    setExpanded(false);
    if (textareaRef) textareaRef.value = "";
    props.onSubmit(trimmed, sentAttachments, webSearch());
  }
  function handleKeyDown(e) {
    if (e.isComposing) return;
    if (props.busy) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!props.enabled) return;
      formRef?.requestSubmit();
    }
  }
  async function handleFileChange() {
    const files = fileInputRef?.files;
    if (!files) return;
    for (const file of files) await addAttachment(file);
    if (fileInputRef) fileInputRef.value = "";
  }
  function handleDragOver(e) {
    e.preventDefault();
    setDragover(true);
  }
  function handleDragLeave(e) {
    if (!formRef.contains(e.relatedTarget)) {
      setDragover(false);
    }
  }
  async function handleDrop(e) {
    e.preventDefault();
    setDragover(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) await addAttachment(file);
  }
  async function handlePaste(e) {
    const files = e.clipboardData?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    for (const file of files) await addAttachment(file);
  }
  const sendDisabled = createMemo(() => {
    if (props.busy) return stopping();
    return !props.enabled || !hasText();
  });
  const sendTitle = () => props.busy ? t("chat.stop_title") : t("chat.send_title");
  const sendAriaLabel = () => props.busy ? t("chat.stop_label") : t("chat.send_label");
  const sendLabel = () => props.busy ? t("chat.stop_label") : t("chat.send_label");
  return (() => {
    var _el$ = _tmpl$4$e(), _el$3 = _el$.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$8.nextSibling, _el$1 = _el$6.nextSibling, _el$10 = _el$1.firstChild, _el$12 = _el$10.nextSibling, _el$13 = _el$4.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling;
    _el$.addEventListener("drop", handleDrop);
    _el$.addEventListener("dragleave", handleDragLeave);
    _el$.addEventListener("dragover", handleDragOver);
    _el$.addEventListener("submit", handleSubmit);
    var _ref$ = formRef;
    typeof _ref$ === "function" ? use(_ref$, _el$) : formRef = _el$;
    insert(_el$, createComponent(Show, {
      get when() {
        return attachments().length > 0;
      },
      get children() {
        var _el$2 = _tmpl$$j();
        insert(_el$2, createComponent(For, {
          get each() {
            return attachments();
          },
          children: (att, index) => (() => {
            var _el$16 = _tmpl$6$9(), _el$18 = _el$16.firstChild, _el$19 = _el$18.nextSibling;
            insert(_el$16, createComponent(Show, {
              get when() {
                return att.mime.startsWith("image/");
              },
              get fallback() {
                return (() => {
                  var _el$20 = _tmpl$7$8();
                  insert(_el$20, () => att.filename?.split(".").pop()?.toUpperCase() || "FILE");
                  return _el$20;
                })();
              },
              get children() {
                var _el$17 = _tmpl$5$d();
                createRenderEffect((_p$) => {
                  var _v$20 = att.url, _v$21 = att.filename;
                  _v$20 !== _p$.e && setAttribute(_el$17, "src", _p$.e = _v$20);
                  _v$21 !== _p$.t && setAttribute(_el$17, "alt", _p$.t = _v$21);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0
                });
                return _el$17;
              }
            }), _el$18);
            insert(_el$18, () => att.filename || "file");
            _el$19.$$click = () => removeAttachment(index());
            createRenderEffect(() => setAttribute(_el$16, "title", att.filename));
            return _el$16;
          })()
        }));
        return _el$2;
      }
    }), _el$3);
    _el$3.addEventListener("change", handleFileChange);
    var _ref$2 = fileInputRef;
    typeof _ref$2 === "function" ? use(_ref$2, _el$3) : fileInputRef = _el$3;
    setAttribute(_el$3, "accept", FILE_ACCEPT);
    _el$5.addEventListener("paste", handlePaste);
    _el$5.$$keydown = handleKeyDown;
    _el$5.$$input = (e) => {
      setText(e.currentTarget.value);
    };
    var _ref$3 = textareaRef;
    typeof _ref$3 === "function" ? use(_ref$3, _el$5) : textareaRef = _el$5;
    _el$7.$$click = () => fileInputRef?.click();
    _el$8.$$click = () => setWebSearch((v) => !v);
    _el$9.$$click = () => setExpanded((v) => !v);
    insert(_el$9, createComponent(Show, {
      get when() {
        return expanded();
      },
      get fallback() {
        return _tmpl$8$7();
      },
      get children() {
        return _tmpl$2$h();
      }
    }));
    _el$1.$$click = (e) => {
      if (props.busy) {
        e.preventDefault();
        props.onStop?.();
      }
    };
    insert(_el$10, createComponent(Show, {
      get when() {
        return props.busy;
      },
      get fallback() {
        return _tmpl$9$5();
      },
      get children() {
        return _tmpl$3$f();
      }
    }));
    insert(_el$12, sendLabel);
    insert(_el$15, () => t("chat.tip"));
    createRenderEffect((_p$) => {
      var _v$ = dragover() ? "true" : void 0, _v$2 = expanded() ? "true" : void 0, _v$3 = !props.enabled, _v$4 = props.enabled ? t("chat.placeholder") : t("chat.placeholder_disabled"), _v$5 = t("chat.attach_title"), _v$6 = t("chat.attach_title"), _v$7 = webSearch() ? "true" : void 0, _v$8 = t("chat.web_search_title"), _v$9 = t("chat.web_search_title"), _v$0 = webSearch(), _v$1 = expanded() ? "true" : void 0, _v$10 = expanded() ? t("chat.collapse_title") : t("chat.expand_title"), _v$11 = expanded() ? t("chat.collapse_title") : t("chat.expand_title"), _v$12 = expanded(), _v$13 = props.busy ? "btnTaskInterrupt" : "chatSend", _v$14 = `chat-send${props.busy ? " chat-interrupt" : ""}`, _v$15 = props.busy ? "button" : "submit", _v$16 = props.busy ? "stop" : "send", _v$17 = sendDisabled(), _v$18 = sendTitle(), _v$19 = sendAriaLabel();
      _v$ !== _p$.e && setAttribute(_el$, "data-dragover", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$5, "data-expanded", _p$.t = _v$2);
      _v$3 !== _p$.a && (_el$5.disabled = _p$.a = _v$3);
      _v$4 !== _p$.o && setAttribute(_el$5, "placeholder", _p$.o = _v$4);
      _v$5 !== _p$.i && setAttribute(_el$7, "title", _p$.i = _v$5);
      _v$6 !== _p$.n && setAttribute(_el$7, "aria-label", _p$.n = _v$6);
      _v$7 !== _p$.s && setAttribute(_el$8, "data-active", _p$.s = _v$7);
      _v$8 !== _p$.h && setAttribute(_el$8, "title", _p$.h = _v$8);
      _v$9 !== _p$.r && setAttribute(_el$8, "aria-label", _p$.r = _v$9);
      _v$0 !== _p$.d && setAttribute(_el$8, "aria-pressed", _p$.d = _v$0);
      _v$1 !== _p$.l && setAttribute(_el$9, "data-active", _p$.l = _v$1);
      _v$10 !== _p$.u && setAttribute(_el$9, "title", _p$.u = _v$10);
      _v$11 !== _p$.c && setAttribute(_el$9, "aria-label", _p$.c = _v$11);
      _v$12 !== _p$.w && setAttribute(_el$9, "aria-pressed", _p$.w = _v$12);
      _v$13 !== _p$.m && setAttribute(_el$1, "id", _p$.m = _v$13);
      _v$14 !== _p$.f && className(_el$1, _p$.f = _v$14);
      _v$15 !== _p$.y && setAttribute(_el$1, "type", _p$.y = _v$15);
      _v$16 !== _p$.g && setAttribute(_el$1, "data-mode", _p$.g = _v$16);
      _v$17 !== _p$.p && (_el$1.disabled = _p$.p = _v$17);
      _v$18 !== _p$.b && setAttribute(_el$1, "title", _p$.b = _v$18);
      _v$19 !== _p$.T && setAttribute(_el$1, "aria-label", _p$.T = _v$19);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0,
      d: void 0,
      l: void 0,
      u: void 0,
      c: void 0,
      w: void 0,
      m: void 0,
      f: void 0,
      y: void 0,
      g: void 0,
      p: void 0,
      b: void 0,
      T: void 0
    });
    createRenderEffect(() => _el$5.value = text());
    return _el$;
  })();
}
delegateEvents(["input", "keydown", "click"]);

var _tmpl$$i = /* @__PURE__ */ template(`<button type=button id=btnPin class=titlebar-btn><svg width=12 height=12 viewBox="0 0 16 16"fill=none aria-hidden=true><path d="M9.5 2L14 6.5l-4 1.5-4 4-1.5-1.5 4-4L7 2.5 9.5 2z"stroke=currentColor stroke-width=1.3 stroke-linejoin=round></path><line x1=2 y1=14 x2=6 y2=10 stroke=currentColor stroke-width=1.3 stroke-linecap=round>`), _tmpl$2$g = /* @__PURE__ */ template(`<button type=button id=btnMinimize class=titlebar-btn><svg width=11 height=11 viewBox="0 0 11 11"fill=none aria-hidden=true><line x1=1 y1=5.5 x2=10 y2=5.5 stroke=currentColor stroke-width=1.3 stroke-linecap=round>`), _tmpl$3$e = /* @__PURE__ */ template(`<button type=button id=btnMaximize class=titlebar-btn>`), _tmpl$4$d = /* @__PURE__ */ template(`<button type=button id=btnClose class="titlebar-btn titlebar-close"><svg width=11 height=11 viewBox="0 0 11 11"fill=none aria-hidden=true><line x1=1 y1=1 x2=10 y2=10 stroke=currentColor stroke-width=1.3 stroke-linecap=round></line><line x1=10 y1=1 x2=1 y2=10 stroke=currentColor stroke-width=1.3 stroke-linecap=round>`), _tmpl$5$c = /* @__PURE__ */ template(`<div class=titlebar-window-controls data-no-drag=true>`);
const CLOSE_HINT_KEY = "oc_close_hint_seen";
async function currentTauriWindow$3() {
  const getCurrent = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent();
    } catch {
    }
  }
  return null;
}
async function nativeMessage$1(message, options) {
  const notify = window.nativeMessage;
  if (typeof notify !== "function") return;
  await notify(message, options).catch(() => void 0);
}
function maximizeLabel(isMaximized) {
  return isMaximized ? t("titlebar.restore") : t("titlebar.maximize");
}
function maximizeIcon(isMaximized) {
  if (isMaximized) {
    return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="0.5" width="7" height="7" rx="0.5" stroke="currentColor"/>
      <path d="M1 3.5V10H7.5" stroke="currentColor" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="0.5" y="0.5" width="10" height="10" rx="0.5" stroke="currentColor"/>
  </svg>`;
}
function WindowControls() {
  const [isMaximized, setIsMaximized] = createSignal(false);
  const [tauriWin, setTauriWin] = createSignal(null);
  const syncMaximize = async (win) => {
    if (!win) return false;
    const maximized = await win.isMaximized?.().catch(() => false);
    setIsMaximized(!!maximized);
    return !!maximized;
  };
  const syncPin = async (win) => {
    if (!win) return;
    const pinned = await win.isAlwaysOnTop?.().catch(() => false);
    setSettingsStore("alwaysOnTop", !!pinned);
    saveSettings();
  };
  const handleMinimize = () => {
    tauriWin()?.minimize?.().catch(() => void 0);
  };
  const handleMaximize = async () => {
    const win = tauriWin();
    if (!win) return;
    const current = await syncMaximize(win);
    if (typeof win.toggleMaximize === "function") {
      await win.toggleMaximize().catch(() => void 0);
    } else if (current) {
      await win.unmaximize?.().catch(() => void 0);
    } else {
      await win.maximize?.().catch(() => void 0);
    }
    await syncMaximize(win);
  };
  const handleClose = async () => {
    const win = tauriWin();
    if (!win) return;
    if (localStorage.getItem(CLOSE_HINT_KEY) !== "true") {
      localStorage.setItem(CLOSE_HINT_KEY, "true");
      await nativeMessage$1(t("titlebar.background_notice"), {
        title: t("titlebar.background_notice_title")
      }).catch(() => void 0);
    }
    if (typeof win.hide === "function") {
      await win.hide().catch(() => void 0);
    } else {
      await win.minimize?.().catch(() => void 0);
    }
  };
  const handlePin = async () => {
    const win = tauriWin();
    if (!win) return;
    const next = !settingsStore.alwaysOnTop;
    await win.setAlwaysOnTop?.(next).catch(() => void 0);
    await syncPin(win);
  };
  onMount(async () => {
    const win = await currentTauriWindow$3();
    if (!win) return;
    setTauriWin(win);
    await win.setAlwaysOnTop?.(settingsStore.alwaysOnTop).catch(() => void 0);
    await syncPin(win);
    await syncMaximize(win);
    let cleanupResized;
    if (typeof win.onResized === "function") {
      const unlisten = await win.onResized(() => {
        void syncMaximize(win);
      }).catch(() => void 0);
      if (typeof unlisten === "function") cleanupResized = unlisten;
    }
    const titlebar = document.getElementById("titlebar");
    const handleTitlebarPointerDown = (event) => {
      if (event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-no-drag="true"], button, input, textarea, select, a, label, summary, [contenteditable="true"]')) {
        return;
      }
      event.preventDefault();
      win.startDragging?.().catch(() => void 0);
    };
    titlebar?.addEventListener("pointerdown", handleTitlebarPointerDown);
    onCleanup(() => cleanupResized?.());
    onCleanup(() => titlebar?.removeEventListener("pointerdown", handleTitlebarPointerDown));
  });
  const pinLabel = () => settingsStore.alwaysOnTop ? t("titlebar.pin.unpin") : t("titlebar.pin.pin");
  const maxLabel = () => maximizeLabel(isMaximized());
  return (() => {
    var _el$ = _tmpl$5$c();
    insert(_el$, createComponent(Show, {
      get when() {
        return tauriWin() !== null;
      },
      get children() {
        var _el$2 = _tmpl$$i();
        _el$2.$$click = () => void handlePin();
        createRenderEffect((_p$) => {
          var _v$ = settingsStore.alwaysOnTop ? "true" : "false", _v$2 = pinLabel(), _v$3 = pinLabel();
          _v$ !== _p$.e && setAttribute(_el$2, "data-pinned", _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$2, "title", _p$.t = _v$2);
          _v$3 !== _p$.a && setAttribute(_el$2, "aria-label", _p$.a = _v$3);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0
        });
        return _el$2;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return tauriWin() !== null;
      },
      get children() {
        var _el$3 = _tmpl$2$g();
        _el$3.$$click = handleMinimize;
        createRenderEffect((_p$) => {
          var _v$4 = t("titlebar.minimize"), _v$5 = t("titlebar.minimize");
          _v$4 !== _p$.e && setAttribute(_el$3, "title", _p$.e = _v$4);
          _v$5 !== _p$.t && setAttribute(_el$3, "aria-label", _p$.t = _v$5);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$3;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return tauriWin() !== null;
      },
      get children() {
        var _el$4 = _tmpl$3$e();
        _el$4.$$click = () => void handleMaximize();
        createRenderEffect((_p$) => {
          var _v$6 = isMaximized() ? "true" : "false", _v$7 = maxLabel(), _v$8 = maxLabel(), _v$9 = maximizeIcon(isMaximized());
          _v$6 !== _p$.e && setAttribute(_el$4, "data-maximized", _p$.e = _v$6);
          _v$7 !== _p$.t && setAttribute(_el$4, "title", _p$.t = _v$7);
          _v$8 !== _p$.a && setAttribute(_el$4, "aria-label", _p$.a = _v$8);
          _v$9 !== _p$.o && (_el$4.innerHTML = _p$.o = _v$9);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0,
          o: void 0
        });
        return _el$4;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return tauriWin() !== null;
      },
      get children() {
        var _el$5 = _tmpl$4$d();
        _el$5.$$click = () => void handleClose();
        createRenderEffect((_p$) => {
          var _v$0 = t("titlebar.close"), _v$1 = t("titlebar.close");
          _v$0 !== _p$.e && setAttribute(_el$5, "title", _p$.e = _v$0);
          _v$1 !== _p$.t && setAttribute(_el$5, "aria-label", _p$.t = _v$1);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$5;
      }
    }), null);
    return _el$;
  })();
}
delegateEvents(["click"]);

const MIN_UI_ZOOM = 0.8;
const MAX_UI_ZOOM = 1.6;
const systemThemeMedia = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
function sanitizeTheme(value) {
  if (value === "light" || value === "dark" || value === "system" || value === "vscode-dark")
    return value;
  return "dark";
}
function sanitizeZoom(value) {
  const next = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) ? Math.min(Math.max(next, MIN_UI_ZOOM), MAX_UI_ZOOM) : 1;
}
function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const sanitized = sanitizeTheme(theme);
  const effective = sanitized === "system" ? systemThemeMedia?.matches ? "light" : "dark" : sanitized;
  document.body.dataset.theme = effective;
}
async function currentTauriWindow$2() {
  const getCurrent = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent();
    } catch {
    }
  }
  return null;
}
async function applyOpacity(opacity) {
  if (typeof document === "undefined") return false;
  const value = sanitizeOpacity(opacity);
  const valueStr = String(value);
  const win = await currentTauriWindow$2();
  if (!win || typeof win.setOpacity !== "function") {
    document.documentElement.style.setProperty(
      "--ui-window-opacity",
      valueStr
    );
    return false;
  }
  const ok = await win.setOpacity(value).then(
    () => true,
    () => false
  );
  document.documentElement.style.setProperty(
    "--ui-window-opacity",
    ok ? "1" : valueStr
  );
  return ok;
}
function applyZoom(zoom) {
  if (typeof document === "undefined") return;
  const sanitized = sanitizeZoom(zoom);
  const width = window.visualViewport?.width ?? window.innerWidth ?? 900;
  const height = window.visualViewport?.height ?? window.innerHeight ?? 760;
  const scale = Math.min(width / 1040, height / 820);
  const base = Math.max(0.82, Math.min(1.04, scale));
  const next = base * sanitized;
  document.documentElement.style.setProperty("--ui-scale", next.toFixed(3));
}
const ZOOM_STEP = 0.1;
function setZoom(value) {
  applyZoom(sanitizeZoom(value));
}
function stepZoom(delta) {
  const current = Number.parseFloat(
    document.documentElement.style.getPropertyValue("--ui-scale") || "1"
  ) || 1;
  const width = window.visualViewport?.width ?? window.innerWidth ?? 900;
  const height = window.visualViewport?.height ?? window.innerHeight ?? 760;
  const scale = Math.min(width / 1040, height / 820);
  const base = Math.max(0.82, Math.min(1.04, scale));
  const currentZoom = base > 0 ? current / base : 1;
  const next = Math.round((currentZoom + delta) * 100) / 100;
  setZoom(next);
}
function handleZoomHotkey(event) {
  if (typeof window === "undefined") return;
  const hasTauri = typeof window.__TAURI__?.core?.invoke === "function";
  if (!hasTauri || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  const plus = event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+" || event.key === "=";
  if (plus) {
    event.preventDefault();
    stepZoom(ZOOM_STEP);
    return;
  }
  const minus = event.code === "Minus" || event.code === "NumpadSubtract" || event.key === "-" || event.key === "_";
  if (minus) {
    event.preventDefault();
    stepZoom(-ZOOM_STEP);
    return;
  }
  const reset = event.code === "Digit0" || event.code === "Numpad0" || event.key === "0";
  if (!reset) return;
  event.preventDefault();
  setZoom(1);
}
function installSystemThemeListener(onchange) {
  if (!systemThemeMedia) return () => {
  };
  systemThemeMedia.addEventListener("change", onchange);
  return () => systemThemeMedia.removeEventListener("change", onchange);
}
async function toggleDevtools() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    await invoke("overlay_toggle_devtools").catch(() => {
    });
  }
}
async function applyWindowOpacity(opacity) {
  const value = String(sanitizeOpacity(opacity));
  const win = await currentTauriWindow$2();
  if (!win || typeof win.setOpacity !== "function") {
    document.documentElement.style.setProperty("--ui-window-opacity", value);
    return false;
  }
  const ok = await win.setOpacity(sanitizeOpacity(opacity)).then(
    () => true,
    () => false
  );
  document.documentElement.style.setProperty("--ui-window-opacity", ok ? "1" : value);
  return ok;
}

var _tmpl$$h = /* @__PURE__ */ template(`<div class=titlebar-menu-wrap data-no-drag=true><button type=button id=btnTitlebarMenu class=titlebar-btn aria-controls=titlebarMenu aria-haspopup=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none aria-hidden=true><circle cx=3.5 cy=8 r=1.2 fill=currentColor></circle><circle cx=8 cy=8 r=1.2 fill=currentColor></circle><circle cx=12.5 cy=8 r=1.2 fill=currentColor></circle></svg></button><div id=titlebarMenu class=titlebar-menu-panel data-no-drag=true><button type=button id=btnLocale class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true>A</span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta id=btnLocaleLabel></span></span></button><div class=titlebar-menu-group id=titlebarThemeGroup role=radiogroup><div class=titlebar-menu-group-head><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><circle cx=8 cy=8 r=3 stroke=currentColor stroke-width=1.2></circle><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span></div><div class=titlebar-theme-options></div></div><button type=button id=btnSettings class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><path d="M3 4h10M3 8h10M3 12h10"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path><circle cx=6 cy=4 r=1.6 fill=currentColor></circle><circle cx=10 cy=8 r=1.6 fill=currentColor></circle><circle cx=7.5 cy=12 r=1.6 fill=currentColor></circle></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span></button><button type=button id=btnLog class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><path d="M3 3h10M3 6.5h8M3 10h6M3 13.5h9"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span></button><button type=button id=btnPin class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><path d="M8 1v6M5.5 7h5l-.5 4H6l-.5-4z"stroke=currentColor stroke-width=1.2 stroke-linecap=round stroke-linejoin=round></path><path d="M8 11v4"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta id=btnPinValue></span></span></button><div class=titlebar-menu-divider aria-hidden=true></div><label class=titlebar-menu-toggle for=chkUnattended><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkUnattended type=checkbox></label><label class=titlebar-menu-toggle for=chkAutoPermission><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkAutoPermission type=checkbox></label><label class=titlebar-menu-toggle for=chkAutoQuestion><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkAutoQuestion type=checkbox></label><label class=titlebar-menu-toggle for=chkShowTranscriptDetails><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkShowTranscriptDetails type=checkbox></label><label class=titlebar-menu-range for=opacityRange><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><span class=titlebar-menu-range-control><input class=titlebar-menu-slider id=opacityRange type=range min=50 max=100 step=5><span class=titlebar-menu-value id=opacityValue>%`), _tmpl$2$f = /* @__PURE__ */ template(`<button type=button class=titlebar-theme-option role=radio><span class=titlebar-theme-option-swatch aria-hidden=true></span><span class=titlebar-theme-option-label>`);
async function currentTauriWindow$1() {
  const getCurrent = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent();
    } catch {
    }
  }
  return null;
}
function TitlebarMenu(props) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const THEME_OPTIONS = [{
    id: "system",
    labelKey: "settings.theme.system"
  }, {
    id: "light",
    labelKey: "settings.theme.light"
  }, {
    id: "dark",
    labelKey: "settings.theme.dark"
  }, {
    id: "vscode-dark",
    labelKey: "settings.theme.vscode_dark"
  }];
  const currentTheme = createMemo(() => sanitizeTheme(settingsStore.theme));
  const themeLabel = createMemo(() => {
    const theme = currentTheme();
    const hit = THEME_OPTIONS.find((opt) => opt.id === theme);
    return hit ? t(hit.labelKey) : t("settings.theme.dark");
  });
  const pinLabel = createMemo(() => settingsStore.alwaysOnTop ? t("common.yes") : t("common.no"));
  const localeLabel = createMemo(() => settingsStore.locale === "zh-CN" ? t("settings.language.zh_cn") : t("settings.language.en_us"));
  const localeToggleTitle = createMemo(() => {
    const next = settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN";
    return next === "zh-CN" ? t("settings.switch_to_zh") : t("settings.switch_to_en");
  });
  const opacityPct = createMemo(() => Math.round(sanitizeOpacity(settingsStore.opacity) * 100));
  function closeMenu() {
    setMenuOpen(false);
  }
  function toggleMenu() {
    setMenuOpen((v) => !v);
  }
  async function handleLocaleToggle() {
    const next = settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN";
    props.onLocaleChange?.(next);
    closeMenu();
  }
  function handleThemeSelect(next) {
    setSettingsStore("theme", next);
    applyTheme(next);
    applySettings({
      ...settingsStore,
      theme: next
    });
    saveSettings();
  }
  function handleOpenSettings() {
    props.onOpenSettings?.();
    closeMenu();
  }
  function handleOpenLog() {
    props.onOpenLog?.();
    closeMenu();
  }
  async function handlePinToggle() {
    const next = !settingsStore.alwaysOnTop;
    const win = await currentTauriWindow$1();
    if (win && typeof win.setAlwaysOnTop === "function") {
      await win.setAlwaysOnTop(next).catch(() => void 0);
      const actual = await win.isAlwaysOnTop?.().catch(() => next);
      setSettingsStore("alwaysOnTop", !!actual);
    } else {
      setSettingsStore("alwaysOnTop", next);
    }
    saveSettings();
    closeMenu();
  }
  async function handleUnattendedChange(checked) {
    try {
      const {
        patchConfig
      } = await __vitePreload(async () => { const {
        patchConfig
      } = await Promise.resolve().then(() => config);return {
        patchConfig
      }},true              ?void 0:void 0);
      await patchConfig({
        experimental: {
          unattended: checked
        }
      });
    } catch (e) {
      console.error("[titlebar] failed to update unattended", e);
    }
    closeMenu();
  }
  async function handleAutoPermissionChange(checked) {
    try {
      const {
        patchConfig
      } = await __vitePreload(async () => { const {
        patchConfig
      } = await Promise.resolve().then(() => config);return {
        patchConfig
      }},true              ?void 0:void 0);
      await patchConfig({
        experimental: {
          auto_permission: checked
        }
      });
    } catch (e) {
      console.error("[titlebar] failed to update auto_permission", e);
    }
    closeMenu();
  }
  async function handleAutoQuestionChange(checked) {
    try {
      const {
        patchConfig
      } = await __vitePreload(async () => { const {
        patchConfig
      } = await Promise.resolve().then(() => config);return {
        patchConfig
      }},true              ?void 0:void 0);
      await patchConfig({
        experimental: {
          auto_question: checked
        }
      });
    } catch (e) {
      console.error("[titlebar] failed to update auto_question", e);
    }
    closeMenu();
  }
  async function handleShowTranscriptDetailsChange(checked) {
    setSettingsStore("showTranscriptDetails", checked);
    applySettings({
      ...settingsStore,
      showTranscriptDetails: checked
    });
    saveSettings();
    closeMenu();
  }
  function handleOpacityInput(rawValue) {
    const next = sanitizeOpacity(Number(rawValue) / 100);
    setSettingsStore("opacity", next);
    void applyOpacity(next);
  }
  async function handleOpacityChange(rawValue) {
    const next = sanitizeOpacity(Number(rawValue) / 100);
    setSettingsStore("opacity", next);
    await applyOpacity(next);
    applySettings({
      ...settingsStore,
      opacity: next
    });
    saveSettings();
    closeMenu();
  }
  onMount(() => {
    function onPointerDown(event) {
      if (!menuOpen()) return;
      const target = event.target;
      if (!(target instanceof Element)) {
        closeMenu();
        return;
      }
      if (target.closest("#titlebarMenu, #btnTitlebarMenu")) return;
      closeMenu();
    }
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      closeMenu();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });
  return (() => {
    var _el$ = _tmpl$$h(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$4.nextSibling, _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$0.nextSibling, _el$14 = _el$9.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$14.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$21.firstChild, _el$23 = _el$22.nextSibling, _el$24 = _el$19.nextSibling, _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling, _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling, _el$29 = _el$24.nextSibling, _el$30 = _el$29.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.firstChild, _el$33 = _el$32.nextSibling, _el$34 = _el$31.nextSibling, _el$35 = _el$30.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$36.firstChild, _el$38 = _el$37.nextSibling, _el$39 = _el$36.nextSibling, _el$40 = _el$35.nextSibling, _el$41 = _el$40.firstChild, _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling, _el$44 = _el$41.nextSibling, _el$45 = _el$40.nextSibling, _el$46 = _el$45.firstChild, _el$47 = _el$46.firstChild, _el$48 = _el$47.nextSibling, _el$49 = _el$46.nextSibling, _el$50 = _el$45.nextSibling, _el$51 = _el$50.firstChild, _el$52 = _el$51.firstChild, _el$53 = _el$52.nextSibling, _el$54 = _el$51.nextSibling, _el$55 = _el$54.firstChild, _el$56 = _el$55.nextSibling, _el$57 = _el$56.firstChild;
    _el$2.$$click = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu();
    };
    _el$4.$$click = () => void handleLocaleToggle();
    insert(_el$7, () => t("settings.language"));
    insert(_el$8, localeLabel);
    insert(_el$11, () => t("settings.theme"));
    insert(_el$12, themeLabel);
    insert(_el$13, createComponent(For, {
      each: THEME_OPTIONS,
      children: (opt) => (() => {
        var _el$58 = _tmpl$2$f(), _el$59 = _el$58.firstChild, _el$60 = _el$59.nextSibling;
        _el$58.$$click = () => handleThemeSelect(opt.id);
        insert(_el$60, () => t(opt.labelKey));
        createRenderEffect((_p$) => {
          var _v$14 = currentTheme() === opt.id, _v$15 = currentTheme() === opt.id ? "true" : "false", _v$16 = opt.id, _v$17 = t(opt.labelKey), _v$18 = t(opt.labelKey), _v$19 = opt.id;
          _v$14 !== _p$.e && setAttribute(_el$58, "aria-checked", _p$.e = _v$14);
          _v$15 !== _p$.t && setAttribute(_el$58, "data-active", _p$.t = _v$15);
          _v$16 !== _p$.a && setAttribute(_el$58, "data-theme-value", _p$.a = _v$16);
          _v$17 !== _p$.o && setAttribute(_el$58, "title", _p$.o = _v$17);
          _v$18 !== _p$.i && setAttribute(_el$58, "aria-label", _p$.i = _v$18);
          _v$19 !== _p$.n && setAttribute(_el$59, "data-theme", _p$.n = _v$19);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0,
          o: void 0,
          i: void 0,
          n: void 0
        });
        return _el$58;
      })()
    }));
    _el$14.$$click = handleOpenSettings;
    insert(_el$17, () => t("titlebar.server_config"));
    insert(_el$18, () => t("common.open"));
    _el$19.$$click = handleOpenLog;
    insert(_el$22, () => t("titlebar.logs"));
    insert(_el$23, () => t("common.open"));
    _el$24.$$click = () => void handlePinToggle();
    insert(_el$27, () => t("titlebar.pin"));
    insert(_el$28, pinLabel);
    insert(_el$32, () => t("titlebar.unattended"));
    insert(_el$33, () => t("titlebar.unattended_hint"));
    _el$34.addEventListener("change", (e) => void handleUnattendedChange(e.target.checked));
    insert(_el$37, () => t("titlebar.auto_permission"));
    insert(_el$38, () => t("titlebar.auto_permission_hint"));
    _el$39.addEventListener("change", (e) => void handleAutoPermissionChange(e.target.checked));
    insert(_el$42, () => t("titlebar.auto_question"));
    insert(_el$43, () => t("titlebar.auto_question_hint"));
    _el$44.addEventListener("change", (e) => void handleAutoQuestionChange(e.target.checked));
    insert(_el$47, () => t("titlebar.full_transcript"));
    insert(_el$48, () => t("titlebar.full_transcript_hint"));
    _el$49.addEventListener("change", (e) => void handleShowTranscriptDetailsChange(e.target.checked));
    insert(_el$52, () => t("titlebar.opacity"));
    insert(_el$53, () => t("titlebar.opacity_hint"));
    _el$55.addEventListener("change", (e) => void handleOpacityChange(e.target.value));
    _el$55.$$input = (e) => handleOpacityInput(e.target.value);
    insert(_el$56, opacityPct, _el$57);
    createRenderEffect((_p$) => {
      var _v$ = t("titlebar.more"), _v$2 = t("titlebar.more"), _v$3 = menuOpen() ? "true" : "false", _v$4 = !menuOpen(), _v$5 = localeToggleTitle(), _v$6 = localeToggleTitle(), _v$7 = currentTheme(), _v$8 = t("settings.theme"), _v$9 = t("titlebar.server_config"), _v$0 = t("titlebar.server_config"), _v$1 = t("titlebar.logs"), _v$10 = t("titlebar.logs"), _v$11 = t("titlebar.pin"), _v$12 = t("titlebar.pin"), _v$13 = settingsStore.alwaysOnTop ? "true" : "false";
      _v$ !== _p$.e && setAttribute(_el$2, "title", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$2, "aria-label", _p$.t = _v$2);
      _v$3 !== _p$.a && setAttribute(_el$2, "aria-expanded", _p$.a = _v$3);
      _v$4 !== _p$.o && (_el$3.hidden = _p$.o = _v$4);
      _v$5 !== _p$.i && setAttribute(_el$4, "title", _p$.i = _v$5);
      _v$6 !== _p$.n && setAttribute(_el$4, "aria-label", _p$.n = _v$6);
      _v$7 !== _p$.s && setAttribute(_el$9, "data-mode", _p$.s = _v$7);
      _v$8 !== _p$.h && setAttribute(_el$9, "aria-label", _p$.h = _v$8);
      _v$9 !== _p$.r && setAttribute(_el$14, "title", _p$.r = _v$9);
      _v$0 !== _p$.d && setAttribute(_el$14, "aria-label", _p$.d = _v$0);
      _v$1 !== _p$.l && setAttribute(_el$19, "title", _p$.l = _v$1);
      _v$10 !== _p$.u && setAttribute(_el$19, "aria-label", _p$.u = _v$10);
      _v$11 !== _p$.c && setAttribute(_el$24, "title", _p$.c = _v$11);
      _v$12 !== _p$.w && setAttribute(_el$24, "aria-label", _p$.w = _v$12);
      _v$13 !== _p$.m && setAttribute(_el$24, "data-pinned", _p$.m = _v$13);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0,
      d: void 0,
      l: void 0,
      u: void 0,
      c: void 0,
      w: void 0,
      m: void 0
    });
    createRenderEffect(() => _el$34.checked = appStore.config?.experimental?.unattended !== false);
    createRenderEffect(() => _el$39.checked = appStore.config?.experimental?.auto_permission === true);
    createRenderEffect(() => _el$44.checked = appStore.config?.experimental?.auto_question === true);
    createRenderEffect(() => _el$49.checked = settingsStore.showTranscriptDetails);
    createRenderEffect(() => _el$55.value = String(opacityPct()));
    return _el$;
  })();
}
delegateEvents(["click", "input"]);

var _tmpl$$g = /* @__PURE__ */ template(`<span id=connBadge class=conn-badge aria-live=polite>`);
function statusLabel(status) {
  if (status === "online") return t("titlebar.connection.online");
  if (status === "connecting") return t("titlebar.connection.connecting");
  return t("titlebar.connection.offline");
}
async function handleRestart() {
  setConnectionStatus("connecting");
  const {
    apiJson
  } = await __vitePreload(async () => { const {
    apiJson
  } = await Promise.resolve().then(() => api);return {
    apiJson
  }},true              ?void 0:void 0);
  try {
    await apiJson("restart", {
      method: "POST",
      signal: AbortSignal.timeout(3e3)
    });
  } catch {
  }
  setTimeout(() => {
    if (typeof location !== "undefined") location.reload();
  }, 2e3);
}
function ConnectionBadge(props) {
  const status = createMemo(() => {
    if (props.status) return props.status;
    if (store.sseConnected) return "online";
    return appStore.connectionStatus;
  });
  const label = createMemo(() => statusLabel(status()));
  return (() => {
    var _el$ = _tmpl$$g();
    _el$.$$dblclick = () => {
      void handleRestart();
    };
    insert(_el$, label);
    createRenderEffect((_p$) => {
      var _v$ = status(), _v$2 = label(), _v$3 = label();
      _v$ !== _p$.e && setAttribute(_el$, "data-status", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$, "title", _p$.t = _v$2);
      _v$3 !== _p$.a && setAttribute(_el$, "aria-label", _p$.a = _v$3);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$;
  })();
}
delegateEvents(["dblclick"]);

let workspaceEpoch = 0;
let tasksSeq = 0;
let boardKickTimer = null;
let tasksKickTimer = null;
function setBoardKickTimer(timer) {
  boardKickTimer = timer;
}
function setTasksKickTimer(timer) {
  tasksKickTimer = timer;
}
function getBoardKickTimer() {
  return boardKickTimer;
}
function getTasksKickTimer() {
  return tasksKickTimer;
}
function setWorkspaceDirectory(value, source = "manual") {
  const next = typeof value === "string" ? value.trim() : "";
  if (source === "manual") {
    setSettingsStore({
      directory: next,
      savedDirectory: next,
      tempDirectory: next ? "" : settingsStore.tempDirectory,
      directoryMode: next ? "custom" : "temp"
    });
  } else {
    setSettingsStore("directory", next);
  }
  return next;
}
function restoreWorkspaceDirectory() {
  const saved = typeof settingsStore.savedDirectory === "string" && settingsStore.savedDirectory.trim() ? settingsStore.savedDirectory.trim() : "";
  const temp = typeof settingsStore.tempDirectory === "string" && settingsStore.tempDirectory.trim() ? settingsStore.tempDirectory.trim() : "";
  const next = saved || temp || (settingsStore.directory ? settingsStore.directory.trim() : "");
  if (!next) return settingsStore.directory;
  setSettingsStore({
    directory: next,
    directoryMode: saved ? "custom" : "temp"
  });
  return next;
}
function workspaceMode() {
  if (!boardStore.selectedTaskID && !boardStore.board) ;
  if (boardStore.selectedTaskID) return "task";
  return "empty";
}
function workspaceModeWithConnection(connected) {
  if (!connected) return "offline";
  if (boardStore.selectedTaskID) return "task";
  return "empty";
}
function hasWorkspaceSelection() {
  return !!boardStore.selectedTaskID;
}
function enterSessionWorkspace() {
  throw new Error("Overlay no longer supports session workspaces");
}
function clearWorkspaceRuntime(options = {}) {
  workspaceEpoch += 1;
  if (boardKickTimer !== null) {
    clearTimeout(boardKickTimer);
    boardKickTimer = null;
  }
  if (tasksKickTimer !== null) {
    clearTimeout(tasksKickTimer);
    tasksKickTimer = null;
  }
  tasksSeq += 1;
  setBoardStore({
    board: null,
    loading: false
  });
  clearMessages();
}
function clearProjectScopeData() {
  setBoardStore("tasks", []);
}
function enterEmptyWorkspace(options = {}) {
  setBoardStore("selectedTaskID", "");
  if (options.restoreDirectory !== false) {
    restoreWorkspaceDirectory();
  }
  clearWorkspaceRuntime(options);
}
function enterTaskWorkspace(taskID, options = {}) {
  if (typeof options.directory === "string" && options.directory.trim()) {
    setWorkspaceDirectory(options.directory, "task");
  }
  setBoardStore("selectedTaskID", taskID || "");
  clearWorkspaceRuntime(options);
}
function getWorkspaceEpoch() {
  return workspaceEpoch;
}
function getTasksSeq() {
  return tasksSeq;
}
async function tauriInvoke$2(command, args) {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    return globalInvoke(command, args);
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}
function hasTauriRuntime$1() {
  return typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function";
}
async function currentTauriWindow() {
  const getCurrent = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent();
    } catch {
    }
  }
  return null;
}
async function withUnpinned(run) {
  const win = await currentTauriWindow();
  if (!win || typeof win.isAlwaysOnTop !== "function" || typeof win.setAlwaysOnTop !== "function") {
    return run();
  }
  const pinned = await win.isAlwaysOnTop().catch(() => false);
  if (!pinned) return run();
  await win.setAlwaysOnTop(false).catch(() => void 0);
  try {
    return await run();
  } finally {
    await win.setAlwaysOnTop(true).catch(() => void 0);
    await win.setFocus?.().catch(() => void 0);
  }
}
function errorText(key, error) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return `${t(key)}: ${detail}`;
}
function absolutePath(value) {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}
function joinPath(base, value) {
  if (!base) return value;
  if (absolutePath(value)) return value;
  if (/[\\/]$/.test(base)) return `${base}${value}`;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${value}`;
}
async function nativeMessage(message, options) {
  const showAppDialog = window.showAppDialog;
  if (typeof showAppDialog === "function") {
    await showAppDialog({
      title: options?.title || t("dialog.notice"),
      message,
      kind: options?.kind || "info",
      okLabel: options?.okLabel || t("common.ok")
    });
  }
}
async function nativePrompt$1(message, options) {
  const showAppDialog = window.showAppDialog;
  if (typeof showAppDialog !== "function") return null;
  const result = await showAppDialog({
    title: options?.title || t("dialog.input"),
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || t("common.submit"),
    cancelLabel: options?.cancelLabel || t("common.cancel"),
    cancel: true,
    input: true,
    inputLabel: options?.inputLabel || t("dialog.value"),
    inputPlaceholder: options?.inputPlaceholder || "",
    inputValue: options?.inputValue || ""
  });
  return result?.confirmed ? result.value : null;
}
async function nativeOpen$1(target) {
  if (!target) return false;
  const url = /^https?:\/\//i.test(target);
  try {
    const opened = url ? await tauriInvoke$2("overlay_open_url", { url: target }) : await tauriInvoke$2("overlay_open_path", { path: target });
    if (opened) return true;
  } catch {
  }
  if (url) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  try {
    const result = await apiJson("path/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target })
    });
    return result?.opened === true;
  } catch (openErr) {
    AppLog.debug("ui", "path/open fallback failed", { target, error: String(openErr) });
    return false;
  }
}
async function createTempDirectory() {
  const created = await tauriInvoke$2("overlay_create_temp_dir").catch(() => void 0);
  return typeof created === "string" ? created.trim() : "";
}
async function pickDirectory(start) {
  const selected = await withUnpinned(
    () => tauriInvoke$2("overlay_pick_dir", { start: start || void 0 })
  );
  return typeof selected === "string" ? selected : "";
}
async function pickFiles(start) {
  const result = await withUnpinned(
    () => tauriInvoke$2("overlay_pick_files", { start: start || void 0 })
  );
  return Array.isArray(result) ? result : [];
}
function activeDirectory() {
  return settingsStore.directory;
}
function sanitizeDirectoryMode(value, directory) {
  if (value === "custom") return "custom";
  if (typeof value === "string" && value.trim() === "temp") return "temp";
  return typeof directory === "string" && directory.trim() ? "custom" : "temp";
}
function savedDirectoryValue(directory, mode) {
  const next = typeof directory === "string" ? directory.trim() : "";
  if (!next) return "";
  return sanitizeDirectoryMode(mode, next) === "custom" ? next : "";
}
function settingsDirectory(settings) {
  return typeof settings?.directory === "string" ? settings.directory.trim() : "";
}
function looksLikeExecutionWorkspace(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(^|[\\/])goal-workspace([\\/]|$)/i.test(text);
}
function workspaceRestoreDirectory(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (looksLikeExecutionWorkspace(text)) return "";
  return text;
}
function rememberWorkspace(input = {}) {
  const taskID = typeof input.taskID === "string" ? input.taskID.trim() : boardStore.selectedTaskID || settingsStore.workspaceTaskID || "";
  const rawDir = typeof input.directory === "string" ? input.directory.trim() : settingsStore.savedDirectory || activeDirectory() || settingsStore.directory || "";
  const directory = workspaceRestoreDirectory(rawDir) || workspaceRestoreDirectory(settingsStore.savedDirectory || "") || "";
  setSettingsStore("workspaceTaskID", taskID);
  setSettingsStore("workspaceDirectory", taskID ? directory : "");
}
const RECENT_DIRS_KEY = "oc_recent_directories";
const MAX_RECENT_DIRS = 10;
function loadRecentDirectories() {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d) => typeof d === "string" && d.trim()) : [];
  } catch {
    return [];
  }
}
function saveRecentDirectories(dirs) {
  try {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs));
  } catch {
  }
}
function addRecentDirectory(dir) {
  if (!dir || typeof dir !== "string") return;
  const normalized = dir.trim();
  if (!normalized) return;
  const dirs = loadRecentDirectories().filter(
    (d) => d.toLowerCase() !== normalized.toLowerCase()
  );
  dirs.unshift(normalized);
  saveRecentDirectories(dirs.slice(0, MAX_RECENT_DIRS));
}
function removeRecentDirectory(dir) {
  if (!dir) return;
  const normalized = dir.trim().toLowerCase();
  saveRecentDirectories(
    loadRecentDirectories().filter((d) => d.toLowerCase() !== normalized)
  );
}
async function applyDirectory(next, options = {}) {
  const save = options.save === true ? next : options.save === false ? "" : null;
  const temp = options.temp === true ? next : options.temp === false ? "" : null;
  const curDir = settingsStore.directory;
  const curSaved = settingsStore.savedDirectory;
  const curTemp = settingsStore.tempDirectory;
  if (next === curDir && (save === null || save === curSaved) && (temp === null || temp === curTemp)) {
    console.log("[applyDir] skipped (same)", {
      next,
      save,
      temp,
      dir: curDir,
      saved: curSaved,
      tempDir: curTemp
    });
    return;
  }
  console.log("[applyDir] switching", { from: curDir, to: next, save, temp });
  setSettingsStore("directoryEpoch", (n) => n + 1);
  setSettingsStore("directory", next);
  if (save !== null) setSettingsStore("savedDirectory", save);
  if (temp !== null) setSettingsStore("tempDirectory", temp);
  setSettingsStore(
    "directoryMode",
    settingsStore.savedDirectory ? "custom" : "temp"
  );
  configure({ directory: next });
  setBoardStore("pendingTasks", []);
  setSettingsStore("workspaceTaskID", "");
  setSettingsStore("workspaceDirectory", "");
  clearProjectScopeData();
  if (options.persist !== false) {
    const persistFn = window.persistOverlaySettings;
    if (typeof persistFn === "function") await persistFn();
  }
  if (options.save === true && next) addRecentDirectory(next);
  const epoch = settingsStore.directoryEpoch;
  const { checkConnection } = await __vitePreload(async () => { const { checkConnection } = await Promise.resolve().then(() => connection);return { checkConnection }},true              ?void 0:void 0);
  if (typeof checkConnection === "function") {
    console.log("[applyDir] checking connection");
    const ok = await checkConnection();
    if (!ok) {
      console.warn("[applyDir] connection failed, aborting");
      return;
    }
  }
  if (epoch !== settingsStore.directoryEpoch) {
    console.log("[applyDir] superseded after connection check, aborting");
    return;
  }
  const { reloadProjectScope } = await __vitePreload(async () => { const { reloadProjectScope } = await Promise.resolve().then(() => config);return { reloadProjectScope }},true              ?void 0:void 0);
  console.log("[applyDir] reloading project scope");
  await reloadProjectScope(options);
  if (epoch !== settingsStore.directoryEpoch) {
    console.log("[applyDir] superseded after reload, discarding");
    return;
  }
  console.log("[applyDir] done, tasks=", boardStore.tasks.length);
}
async function setActiveDirectory(value, options = {}) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next || next === settingsStore.directory) return;
  await applyDirectory(next, { ...options, persist: false });
}
async function browseDirectory() {
  try {
    const selected = await pickDirectory(activeDirectory());
    if (!selected) return;
    await setDirectory(selected);
  } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.set_failed", e), {
      title: t("cwd.title"),
      kind: "error"
    });
  }
}
async function createDirectory() {
  try {
    const parent = await pickDirectory(activeDirectory());
    if (!parent) return;
    const name = await nativePrompt$1(t("cwd.create_prompt"), {
      title: t("cwd.create_title"),
      okLabel: t("common.create"),
      inputLabel: t("cwd.folder"),
      inputPlaceholder: t("cwd.folder_placeholder")
    });
    const value = name?.trim();
    if (!value) return;
    const target = joinPath(parent, value);
    const created = await tauriInvoke$2("overlay_create_dir", { path: target }).catch(
      () => void 0
    );
    if (!created) throw new Error(t("cwd.create_unavailable"));
    await setDirectory(target);
    if (settingsStore.initGit) {
      const { initGitCurrent } = await __vitePreload(async () => { const { initGitCurrent } = await Promise.resolve().then(() => git);return { initGitCurrent }},true              ?void 0:void 0);
      await initGitCurrent({ notify: false });
    }
  } catch (e) {
    AppLog.error("ui", "Failed to create working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.create_failed", e), {
      title: t("cwd.title"),
      kind: "error"
    });
  }
}
async function openDirectory(target) {
  const dir = target ?? activeDirectory();
  try {
    if (!dir) return;
    const opened = await nativeOpen$1(dir);
    if (opened) return;
    await nativeMessage(dir, {
      title: t("cwd.title"),
      kind: "info"
    });
  } catch (e) {
    AppLog.error("ui", "Failed to open working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.open_failed", e), {
      title: t("cwd.title"),
      kind: "error"
    });
  }
}
async function resetDirectory() {
  try {
    await setTempDirectory();
  } catch (e) {
    AppLog.error("ui", "Failed to reset working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.reset_failed", e), {
      title: t("cwd.title"),
      kind: "error"
    });
  }
}
async function setDirectory(value, options = {}) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) {
    if (settingsStore.tempDirectory) {
      await applyDirectory(settingsStore.tempDirectory, { ...options, save: false });
      return;
    }
    await setTempDirectory(options);
    return;
  }
  await applyDirectory(next, { ...options, save: true, temp: false });
}
async function setTempDirectory(options = {}) {
  if (!hasTauriRuntime$1()) {
    await applyDirectory("", { ...options, save: false, temp: false });
    return;
  }
  const next = await createTempDirectory();
  if (!next) throw new Error(t("cwd.create_unavailable"));
  const { scaffoldProjectConfig } = await __vitePreload(async () => { const { scaffoldProjectConfig } = await Promise.resolve().then(() => config);return { scaffoldProjectConfig }},true              ?void 0:void 0);
  await scaffoldProjectConfig(next);
  await applyDirectory(next, { ...options, save: false, temp: true });
}
async function ensureDefaultDirectory() {
  if (settingsStore.savedDirectory) {
    setSettingsStore("directory", settingsStore.savedDirectory);
    setSettingsStore("directoryMode", "custom");
    return false;
  }
  if (settingsStore.tempDirectory) {
    setSettingsStore("directory", settingsStore.tempDirectory);
    setSettingsStore("directoryMode", "temp");
    return false;
  }
  if (!hasTauriRuntime$1()) return false;
  const next = await createTempDirectory();
  if (!next) return false;
  const scaffoldProjectConfig = window.scaffoldProjectConfig;
  if (typeof scaffoldProjectConfig === "function") {
    await scaffoldProjectConfig(next);
  }
  setSettingsStore("tempDirectory", next);
  setSettingsStore("directory", next);
  setSettingsStore("savedDirectory", "");
  setSettingsStore("directoryMode", "temp");
  const persistFn = window.persistOverlaySettings;
  if (typeof persistFn === "function") await persistFn();
  return true;
}
async function ensureWorkspaceDirectory() {
  if (activeDirectory()) return activeDirectory();
  const { loadMeta } = await __vitePreload(async () => { const { loadMeta } = await Promise.resolve().then(() => meta);return { loadMeta }},true              ?void 0:void 0);
  if (typeof loadMeta === "function") await loadMeta();
  if (!settingsStore.directory && boardStore.path?.directory) {
    setSettingsStore("directory", boardStore.path.directory);
  }
  return activeDirectory();
}
function goalRunPriority(status) {
  if (status === "running") return 0;
  if (status === "blocked") return 1;
  if (status === "accepted") return 2;
  if (status === "queued") return 3;
  if (status === "completed") return 4;
  if (status === "failed") return 5;
  if (status === "aborted") return 6;
  return 7;
}
function currentExecutionDirectory() {
  const goalRuns = Array.isArray(boardStore.board?.goalRuns) ? boardStore.board.goalRuns : [];
  const rows = goalRuns.filter(
    (item) => typeof item?.workspaceDir === "string" && item.workspaceDir.trim()
  ).toSorted(
    (a, b) => goalRunPriority(a?.status) - goalRunPriority(b?.status) || (b?.time?.updated || 0) - (a?.time?.updated || 0)
  );
  return rows[0]?.workspaceDir?.trim() || "";
}

const workspace = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  activeDirectory,
  addRecentDirectory,
  applyDirectory,
  browseDirectory,
  clearProjectScopeData,
  clearWorkspaceRuntime,
  createDirectory,
  createTempDirectory,
  currentExecutionDirectory,
  ensureDefaultDirectory,
  ensureWorkspaceDirectory,
  enterEmptyWorkspace,
  enterSessionWorkspace,
  enterTaskWorkspace,
  getBoardKickTimer,
  getTasksKickTimer,
  getTasksSeq,
  getWorkspaceEpoch,
  hasWorkspaceSelection,
  loadRecentDirectories,
  looksLikeExecutionWorkspace,
  openDirectory,
  pickDirectory,
  pickFiles,
  rememberWorkspace,
  removeRecentDirectory,
  resetDirectory,
  restoreWorkspaceDirectory,
  sanitizeDirectoryMode,
  saveRecentDirectories,
  savedDirectoryValue,
  setActiveDirectory,
  setBoardKickTimer,
  setDirectory,
  setTasksKickTimer,
  setTempDirectory,
  setWorkspaceDirectory,
  settingsDirectory,
  workspaceMode,
  workspaceModeWithConnection,
  workspaceRestoreDirectory
}, Symbol.toStringTag, { value: 'Module' }));

async function loadMeta() {
  const epoch = settingsStore.directoryEpoch;
  try {
    const [path, vcs] = await Promise.all([
      apiJson("path"),
      apiJson("vcs")
    ]);
    if (epoch !== settingsStore.directoryEpoch) return;
    const directory = path && typeof path.directory === "string" ? path.directory.trim() : "";
    setPath(directory ? { directory } : null);
    if (!settingsStore.directory && directory) {
      setWorkspaceDirectory(directory, "auto");
    }
    setVcs(vcs ?? null);
    setAppStore("config", (prev) => ({
      ...prev ?? {},
      _metaPath: directory ? { directory } : null,
      _metaVcs: vcs ?? null
    }));
  } catch (e) {
    AppLog.debug("meta", "loadMeta failed, resetting path/vcs", {
      error: String(e)
    });
    if (epoch !== settingsStore.directoryEpoch) return;
    setPath(null);
    setVcs(null);
    setAppStore("config", (prev) => ({
      ...prev ?? {},
      _metaPath: null,
      _metaVcs: null
    }));
  } finally {
    renderMeta();
  }
}
function gitLabel(vcs, dir) {
  if (!dir) return t("git.unavailable");
  if (vcs === null || vcs === void 0) return t("git.unavailable");
  if (!vcs.initialized) return t("git.init");
  if (!vcs.branch) return t("git.no_commits");
  const parts = [vcs.branch];
  if (vcs.ahead) parts.push(`+${vcs.ahead}`);
  if (vcs.behind) parts.push(`-${vcs.behind}`);
  if (vcs.conflicts) parts.push(t("git.conflicts", { count: vcs.conflicts }));
  if (vcs.dirty) {
    const changes = [];
    if (vcs.staged) changes.push(t("git.staged", { count: vcs.staged }));
    if (vcs.modified) changes.push(t("git.modified", { count: vcs.modified }));
    if (vcs.untracked) changes.push(t("git.untracked", { count: vcs.untracked }));
    parts.push(changes.join(" "));
  } else {
    parts.push(t("git.clean"));
  }
  return parts.filter(Boolean).join(" · ");
}
function gitTitle(vcs, dir) {
  if (!dir) return "";
  if (vcs === null || vcs === void 0) return "";
  if (!vcs.initialized) return t("git.init_title");
  if (!vcs.branch) return t("git.no_commits_title");
  return [
    t("git.branch", { value: vcs.branch }),
    t("git.clean_title", { value: vcs.clean ? t("common.yes") : t("common.no") }),
    t("git.staged", { count: vcs.staged ?? 0 }),
    t("git.modified", { count: vcs.modified ?? 0 }),
    t("git.untracked", { count: vcs.untracked ?? 0 }),
    t("git.conflicts", { count: vcs.conflicts ?? 0 }),
    t("git.ahead", { count: vcs.ahead ?? 0 }),
    t("git.behind", { count: vcs.behind ?? 0 })
  ].join("\n");
}
function canInitGit$1() {
  const vcs = boardStore.vcs;
  if (vcs === null || vcs === void 0) return false;
  return !!settingsStore.directory && !vcs.initialized;
}
function relativePathFrom(base, target) {
  if (!base || !target) return "";
  const norm = (s) => s.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const nb = norm(base);
  const nt = norm(target);
  if (nt.startsWith(nb + "/")) return target.slice(base.replace(/[\\/]+$/, "").length + 1);
  return "";
}
function shortPath(p) {
  const parts = p.replace(/[\\/]+/g, "/").replace(/\/+$/, "").split("/");
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join("/")}`;
}
function renderMeta() {
  const dirNode = document.getElementById("taskDir");
  const workspaceNode = document.getElementById("taskWorkspaceDir");
  const gitNode = document.getElementById("taskGit");
  const dir = settingsStore.directory || boardStore.board?.task?.directory || "";
  const vcs = boardStore.vcs;
  if (dirNode) {
    dirNode.innerHTML = pathBreadcrumb(dir);
    dirNode.setAttribute("title", dir || t("cwd.unavailable"));
    dirNode.dataset.empty = dir ? "false" : "true";
    const path = dirNode.querySelector(".task-dir-path");
    if (path instanceof HTMLElement) path.scrollLeft = path.scrollWidth;
  }
  if (workspaceNode) {
    const executionDir = Array.isArray(boardStore.board?.goalRuns) && boardStore.board.goalRuns.find((item) => item?.workspaceDir)?.workspaceDir;
    const workspaceText = typeof executionDir === "string" ? executionDir.trim() : "";
    const dirText = dir.replace(/[\\/]+$/, "");
    const same = !!dirText && !!workspaceText && dirText.toLowerCase() === workspaceText.toLowerCase();
    const show = !!workspaceText && !same;
    const label = relativePathFrom(dirText, workspaceText) || shortPath(workspaceText);
    workspaceNode.textContent = show ? t("cwd.execution_workspace", { value: label }) : "";
    workspaceNode.setAttribute("title", show ? workspaceText : "");
    workspaceNode.hidden = !show;
  }
  if (gitNode) {
    const actionable = canInitGit$1();
    const unborn = vcs?.initialized && !vcs?.branch;
    gitNode.textContent = gitLabel(vcs, dir);
    gitNode.setAttribute("title", gitTitle(vcs, dir));
    gitNode.dataset.state = actionable ? "action" : unborn ? "unborn" : vcs?.dirty ? "dirty" : vcs?.clean ? "clean" : "idle";
    gitNode.dataset.actionable = String(actionable);
    gitNode.toggleAttribute("disabled", !actionable);
  }
}
function normalizeDiffs(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item && typeof item.file === "string").map((item) => ({
    file: String(item.file || "").replace(/^[ab]\//, ""),
    before: typeof item.before === "string" ? item.before : void 0,
    after: typeof item.after === "string" ? item.after : void 0,
    additions: Number.isFinite(Number(item.additions)) ? Number(item.additions) : 0,
    deletions: Number.isFinite(Number(item.deletions)) ? Number(item.deletions) : 0,
    status: diffStatus(item)
  })).sort((a, b) => a.file.localeCompare(b.file));
}
function diffStatus(item) {
  if (item.status === "added" || item.status === "deleted" || item.status === "modified") {
    return item.status;
  }
  if (!item.before && item.after) return "added";
  if (item.before && !item.after) return "deleted";
  return "modified";
}
function deriveChanges() {
  if (!boardStore.selectedTaskID) return [];
  const board = boardStore.board;
  const delivery = board?.acceptedDelivery?.result?.diffs || board?.delivery?.result?.diffs || board?.candidateDelivery?.result?.diffs || [];
  return normalizeDiffs(delivery);
}

const meta = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  deriveChanges,
  diffStatus,
  loadMeta,
  normalizeDiffs,
  renderMeta
}, Symbol.toStringTag, { value: 'Module' }));

let cache = null;
function deliveryRunID() {
  const board = boardStore.board;
  const delivery = board?.acceptedDelivery || board?.delivery || board?.candidateDelivery;
  return typeof delivery?.runID === "string" ? delivery.runID : "";
}
function currentChanges() {
  const derived = deriveChanges();
  if (derived.length > 0) return derived;
  if (Array.isArray(boardStore.changes) && boardStore.changes.length > 0) {
    return boardStore.changes;
  }
  const raw = boardStore.board?.changes;
  return Array.isArray(raw) ? raw : [];
}
async function fetchFullDiffs(runID) {
  if (cache && cache.runID === runID) return cache.diffs;
  const data = await apiJson(`run/${encodeURIComponent(runID)}/delivery`);
  const rawDiffs = data?.result?.diffs;
  const diffs = (Array.isArray(rawDiffs) ? rawDiffs : []).filter((d) => d && typeof d.file === "string").map((d) => ({
    file: String(d.file || "").replace(/^[ab]\//, ""),
    status: d.status || (!d.before && d.after ? "added" : d.before && !d.after ? "deleted" : "modified"),
    additions: typeof d.additions === "number" ? d.additions : 0,
    deletions: typeof d.deletions === "number" ? d.deletions : 0,
    before: typeof d.before === "string" ? d.before : void 0,
    after: typeof d.after === "string" ? d.after : void 0
  }));
  cache = { runID, diffs };
  return diffs;
}
async function resolveDiff(filePath) {
  const changes = currentChanges();
  const stub = changes.find((c) => c.file === filePath) || null;
  if (stub && (stub.before !== void 0 || stub.after !== void 0)) {
    return stub;
  }
  const runID = deliveryRunID();
  if (!runID) return stub;
  try {
    const full = await fetchFullDiffs(runID);
    const hit = full.find((d) => d.file === filePath);
    return hit || stub;
  } catch {
    return stub;
  }
}

var _tmpl$$f = /* @__PURE__ */ template(`<div class=diff-lines>`), _tmpl$2$e = /* @__PURE__ */ template(`<div class=diff-empty><p class=empty-hint>`), _tmpl$3$d = /* @__PURE__ */ template(`<div class=diff-row><div class=diff-gutter></div><div class=diff-num></div><div class=diff-num></div><div class=diff-code>`), _tmpl$4$c = /* @__PURE__ */ template(`<div class=diff-row data-kind=skip><div class=diff-gutter>...</div><div class=diff-num></div><div class=diff-num></div><div class=diff-code>`);
function splitDiffLines(text) {
  const value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!value) return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function diffMiddle(left, right, leftStart, rightStart) {
  if (!left.length && !right.length) return [];
  if (!left.length) {
    return right.map((text, index) => ({
      kind: "add",
      left: "",
      right: rightStart + index,
      text
    }));
  }
  if (!right.length) {
    return left.map((text, index) => ({
      kind: "del",
      left: leftStart + index,
      right: "",
      text
    }));
  }
  if (left.length * right.length > 12e4) {
    return [...left.map((text, index) => ({
      kind: "del",
      left: leftStart + index,
      right: "",
      text
    })), ...right.map((text, index) => ({
      kind: "add",
      left: "",
      right: rightStart + index,
      text
    }))];
  }
  const grid = Array.from({
    length: left.length + 1
  }, () => new Uint32Array(right.length + 1));
  for (let i2 = left.length - 1; i2 >= 0; i2 -= 1) {
    for (let j2 = right.length - 1; j2 >= 0; j2 -= 1) {
      grid[i2][j2] = left[i2] === right[j2] ? grid[i2 + 1][j2 + 1] + 1 : Math.max(grid[i2 + 1][j2], grid[i2][j2 + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({
        kind: "context",
        left: leftStart + i,
        right: rightStart + j,
        text: left[i]
      });
      i += 1;
      j += 1;
      continue;
    }
    if (grid[i + 1][j] >= grid[i][j + 1]) {
      ops.push({
        kind: "del",
        left: leftStart + i,
        right: "",
        text: left[i]
      });
      i += 1;
      continue;
    }
    ops.push({
      kind: "add",
      left: "",
      right: rightStart + j,
      text: right[j]
    });
    j += 1;
  }
  while (i < left.length) {
    ops.push({
      kind: "del",
      left: leftStart + i,
      right: "",
      text: left[i]
    });
    i += 1;
  }
  while (j < right.length) {
    ops.push({
      kind: "add",
      left: "",
      right: rightStart + j,
      text: right[j]
    });
    j += 1;
  }
  return ops;
}
function buildDiffOps(before, after) {
  const left = splitDiffLines(before);
  const right = splitDiffLines(after);
  const ops = [];
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    ops.push({
      kind: "context",
      left: start + 1,
      right: start + 1,
      text: left[start]
    });
    start += 1;
  }
  let leftEnd = left.length - 1;
  let rightEnd = right.length - 1;
  const suffix = [];
  while (leftEnd >= start && rightEnd >= start && left[leftEnd] === right[rightEnd]) {
    suffix.push({
      kind: "context",
      left: leftEnd + 1,
      right: rightEnd + 1,
      text: left[leftEnd]
    });
    leftEnd -= 1;
    rightEnd -= 1;
  }
  ops.push(...diffMiddle(left.slice(start, leftEnd + 1), right.slice(start, rightEnd + 1), start + 1, start + 1));
  ops.push(...suffix.reverse());
  return ops;
}
function collapseDiffOps(ops) {
  const next = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind !== "context") {
      next.push(ops[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].kind === "context") {
      end += 1;
    }
    const chunk = ops.slice(index, end);
    if (chunk.length <= 8) {
      next.push(...chunk);
    } else {
      next.push(...chunk.slice(0, 3));
      next.push({
        kind: "skip",
        count: chunk.length - 6
      });
      next.push(...chunk.slice(-3));
    }
    index = end;
  }
  return next;
}
function changeStatusLabel(status) {
  if (status === "added") return t("files.status.added");
  if (status === "deleted") return t("files.status.deleted");
  return t("files.status.modified");
}
function DiffView(props) {
  const ops = createMemo(() => collapseDiffOps(buildDiffOps(props.item.before, props.item.after)));
  const hasChanges = createMemo(() => {
    if (props.item.before == null && props.item.after == null) return false;
    if (!props.item.before && !props.item.after) return false;
    return ops().some((op) => op.kind === "add" || op.kind === "del");
  });
  return createComponent(Show, {
    get when() {
      return hasChanges();
    },
    get fallback() {
      return (() => {
        var _el$2 = _tmpl$2$e(), _el$3 = _el$2.firstChild;
        insert(_el$3, () => t("diff.no_preview"));
        return _el$2;
      })();
    },
    get children() {
      var _el$ = _tmpl$$f();
      insert(_el$, createComponent(For, {
        get each() {
          return ops();
        },
        children: (line) => createComponent(Show, {
          get when() {
            return line.kind !== "skip";
          },
          get fallback() {
            return (() => {
              var _el$9 = _tmpl$4$c(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling, _el$11 = _el$10.nextSibling;
              insert(_el$11, () => tc("diff.unchanged_hidden", line.count ?? 0));
              return _el$9;
            })();
          },
          get children() {
            var _el$4 = _tmpl$3$d(), _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling;
            insert(_el$5, (() => {
              var _c$ = memo(() => line.kind === "add");
              return () => _c$() ? "+" : line.kind === "del" ? "-" : " ";
            })());
            insert(_el$6, () => line.left ?? "");
            insert(_el$7, () => line.right ?? "");
            insert(_el$8, () => line.text ?? " ");
            createRenderEffect(() => setAttribute(_el$4, "data-kind", line.kind));
            return _el$4;
          }
        })
      }));
      return _el$;
    }
  });
}

var _tmpl$$e = /* @__PURE__ */ template(`<div class=changes-summary><span></span><span class=changes-total><span data-tone=add>+</span><span data-tone=del>-`), _tmpl$2$d = /* @__PURE__ */ template(`<div class=changes-list>`), _tmpl$3$c = /* @__PURE__ */ template(`<div class=changes-panel>`), _tmpl$4$b = /* @__PURE__ */ template(`<p class=empty-hint>`), _tmpl$5$b = /* @__PURE__ */ template(`<button type=button class=change-row><span class=change-main><span class=change-path></span></span><span class=change-meta><span class=change-status></span><span class=diff-dialog-stat data-tone=add>+</span><span class=diff-dialog-stat data-tone=del>-`);
function ChangesPanel(props) {
  const files = createMemo(() => {
    if (props.changes !== void 0) return props.changes;
    return currentChanges();
  });
  const totalAdditions = createMemo(() => files().reduce((sum, item) => sum + (item.additions ?? 0), 0));
  const totalDeletions = createMemo(() => files().reduce((sum, item) => sum + (item.deletions ?? 0), 0));
  async function handleRowClick(item) {
    const openWorkspaceDiff = window.openWorkspaceDiff;
    if (typeof openWorkspaceDiff !== "function") return;
    void resolveDiff(item.file);
    openWorkspaceDiff(item.file);
  }
  return (() => {
    var _el$ = _tmpl$3$c();
    insert(_el$, createComponent(Show, {
      get when() {
        return files().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$0 = _tmpl$4$b();
          insert(_el$0, (() => {
            var _c$ = memo(() => !!props.hasSelectedTask);
            return () => _c$() ? t("files.unavailable") : t("files.select_target");
          })());
          return _el$0;
        })();
      },
      get children() {
        return [(() => {
          var _el$2 = _tmpl$$e(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild; _el$5.firstChild; var _el$7 = _el$5.nextSibling; _el$7.firstChild;
          insert(_el$3, () => tc("files.changed", files().length));
          insert(_el$5, totalAdditions, null);
          insert(_el$7, totalDeletions, null);
          return _el$2;
        })(), (() => {
          var _el$9 = _tmpl$2$d();
          insert(_el$9, createComponent(For, {
            get each() {
              return files();
            },
            children: (item, index) => (() => {
              var _el$1 = _tmpl$5$b(), _el$10 = _el$1.firstChild, _el$11 = _el$10.firstChild, _el$12 = _el$10.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling; _el$14.firstChild; var _el$16 = _el$14.nextSibling; _el$16.firstChild;
              _el$1.$$click = () => void handleRowClick(item);
              insert(_el$11, () => item.file);
              insert(_el$13, () => changeStatusLabel(item.status));
              insert(_el$14, () => item.additions, null);
              insert(_el$16, () => item.deletions, null);
              createRenderEffect((_p$) => {
                var _v$ = index(), _v$2 = item.file, _v$3 = item.status;
                _v$ !== _p$.e && setAttribute(_el$1, "data-change-index", _p$.e = _v$);
                _v$2 !== _p$.t && setAttribute(_el$1, "title", _p$.t = _v$2);
                _v$3 !== _p$.a && setAttribute(_el$13, "data-status", _p$.a = _v$3);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$1;
            })()
          }));
          return _el$9;
        })()];
      }
    }));
    return _el$;
  })();
}
delegateEvents(["click"]);

var _tmpl$$d = /* @__PURE__ */ template(`<div class=log-fields>`), _tmpl$2$c = /* @__PURE__ */ template(`<div class=log-detail-block><div class=log-detail-title></div><pre class=log-detail-pre>`), _tmpl$3$b = /* @__PURE__ */ template(`<details class=log-detail><summary></summary><div class=log-detail-block><div class=log-detail-title></div><pre class=log-detail-pre>`), _tmpl$4$a = /* @__PURE__ */ template(`<span class=log-chip>=`), _tmpl$5$a = /* @__PURE__ */ template(`<span class=log-delta>`), _tmpl$6$8 = /* @__PURE__ */ template(`<span class=log-service>`), _tmpl$7$7 = /* @__PURE__ */ template(`<div class=log-line><div class=log-line-head><span class=log-source></span><span>[<!>]</span><span class=log-ts></span></div><div class=log-msg>`), _tmpl$8$6 = /* @__PURE__ */ template(`<dialog id=logDialog class="dialog dialog-wide"><div class=dialog-form><div class=dialog-header><span class=dialog-title></span><div class=dialog-header-actions><select id=logLevelFilter class="select select-sm"><option value=debug>DEBUG</option><option value=info>INFO</option><option value=warn>WARN</option><option value=error>ERROR</option></select><button type=button id=btnLogServerLogs class="btn btn-ghost mini"></button><button type=button id=btnLogRefresh class="btn btn-ghost mini"></button><button type=button id=btnLogCopy class="btn btn-ghost mini"></button><button type=button id=btnLogClear class="btn btn-ghost mini danger"></button><button type=button id=btnCloseLog class="btn btn-ghost mini"></button></div></div><div id=logViewerBody class=log-viewer>`), _tmpl$9$4 = /* @__PURE__ */ template(`<div class=empty-hint>`);
let _serverLogLines = [];
async function loadServerLogs() {
  try {
    const data = await apiJson("log/tail?n=500");
    _serverLogLines = Array.isArray(data?.lines) ? data.lines : [];
  } catch {
    _serverLogLines = [];
  }
}
function stringifyLogValue(value, space = 0) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return String(value ?? "");
  }
}
function clipText(value, limit = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}
function logPreviewValue(value) {
  return clipText(stringifyLogValue(value), 80);
}
function isRecord$2(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function logDetailFields(fields) {
  if (!isRecord$2(fields)) return {};
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "service"));
}
function logSourceLabel(source) {
  if (source === "server") return "Server";
  if (source === "pipeline") return "Pipeline";
  return "Overlay";
}
function parseLogValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[\[{"]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
    }
  }
  return text;
}
function scanBalancedLogValue(text, start) {
  if (text[start] === '"') {
    let escaped2 = false;
    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i];
      if (escaped2) {
        escaped2 = false;
        continue;
      }
      if (ch === "\\") {
        escaped2 = true;
        continue;
      }
      if (ch === '"') return i + 1;
    }
    return text.length;
  }
  const pairs = {
    "{": "}",
    "[": "]"
  };
  const stack = [text[start]];
  let quoted = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const open = stack[stack.length - 1];
      if (pairs[open] === ch) {
        stack.pop();
        if (stack.length === 0) return i + 1;
      }
    }
  }
  return text.length;
}
function scanLogValueEnd(text, start) {
  if (!text[start]) return start;
  const first = text[start];
  if (first === '"' || first === "{" || first === "[") {
    return scanBalancedLogValue(text, start);
  }
  let cursor = start;
  while (cursor < text.length) {
    const nextSpace = text.indexOf(" ", cursor);
    if (nextSpace < 0) return text.length;
    let probe = nextSpace;
    while (probe < text.length && text[probe] === " ") probe++;
    if (/^[A-Za-z0-9_.-]+=/.test(text.slice(probe))) return nextSpace;
    cursor = probe;
  }
  return text.length;
}
function parseLeadingLogFields(text) {
  const fields = {};
  let index = 0;
  while (index < text.length) {
    while (text[index] === " ") index++;
    const match = /^([A-Za-z0-9_.-]+)=/.exec(text.slice(index));
    if (!match) break;
    const key = match[1];
    index += match[0].length;
    const end = scanLogValueEnd(text, index);
    fields[key] = parseLogValue(text.slice(index, end));
    index = end;
  }
  return {
    fields,
    end: index
  };
}
function parseServerLogLine(raw) {
  const match = raw.match(/^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s+(\+\d+ms)\s+(.*)$/);
  if (!match) {
    return {
      level: "info",
      ts: "",
      delta: "",
      service: "",
      message: raw,
      fields: {},
      raw,
      source: "server"
    };
  }
  const [, levelRaw, ts, delta, rest] = match;
  const parsed = parseLeadingLogFields(rest);
  const service = typeof parsed.fields.service === "string" ? parsed.fields.service : "";
  const message = rest.slice(parsed.end).trim() || rest.trim();
  return {
    level: levelRaw.toLowerCase(),
    ts,
    delta,
    service,
    message,
    fields: parsed.fields,
    raw,
    source: "server"
  };
}
function fmtElapsed(ms) {
  const s = ms / 1e3;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  return m + "m" + (s - m * 60).toFixed(0) + "s";
}
function buildLogEntries(overlayEntries, ndjsonEvents, filterLevel) {
  const levelOrder = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  const threshold = levelOrder[filterLevel] ?? 0;
  const serverLines = _serverLogLines.map(parseServerLogLine).filter((e) => (levelOrder[e.level] ?? 0) >= threshold);
  const pipelineLines = (Array.isArray(ndjsonEvents) ? ndjsonEvents : []).filter((ev) => ev.kind !== "tool_delta").flatMap((ev) => {
    const level = ev.kind === "error" ? "error" : "info";
    if ((levelOrder[level] ?? 0) < threshold) return [];
    const stage = ev.stage || "";
    const kind = ev.kind || "";
    const toolName = ev.toolName || "";
    const summary = ev.summary || ev.text || "";
    const parts = [];
    if (kind === "tool_call" && toolName) parts.push(`→ ${toolName}`);
    else if (kind === "tool_result" && toolName) parts.push(`← ${toolName}`);
    else if (kind === "status") parts.push(summary);
    else if (kind === "message_delta") parts.push("[text delta]");
    if (kind !== "status" && summary) {
      parts.push(summary.length > 150 ? summary.slice(0, 150) + "…" : summary);
    }
    const elapsed = typeof ev.elapsed_ms === "number" ? fmtElapsed(ev.elapsed_ms) : "";
    return [{
      level,
      ts: ev.at || "",
      service: stage,
      delta: elapsed,
      message: parts.join(" "),
      fields: {
        kind,
        ...toolName ? {
          tool: toolName
        } : {},
        ...ev.status ? {
          status: ev.status
        } : {}
      },
      raw: "",
      source: "pipeline"
    }];
  });
  return [...serverLines, ...pipelineLines, ...overlayEntries].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
}
function formatLogText(entries) {
  return entries.map((e) => {
    const parts = [`[${String(e.source || "client").toUpperCase()}]`, `[${String(e.level || "info").toUpperCase()}]`];
    if (e.ts) parts.push(e.ts);
    if (e.service) parts.push(e.service);
    parts.push(e.message || "");
    const fields = logDetailFields(e.fields);
    if (Object.keys(fields).length) parts.push(stringifyLogValue(fields));
    return parts.join(" ");
  }).join("\n");
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function LogEntryDetail(props) {
  const fields = createMemo(() => logDetailFields(props.entry.fields));
  const items = createMemo(() => Object.entries(fields()));
  return [createComponent(Show, {
    get when() {
      return items().length > 0;
    },
    get children() {
      return [(() => {
        var _el$ = _tmpl$$d();
        insert(_el$, createComponent(For, {
          get each() {
            return items().slice(0, 6);
          },
          children: ([key, value]) => (() => {
            var _el$13 = _tmpl$4$a(), _el$14 = _el$13.firstChild;
            insert(_el$13, key, _el$14);
            insert(_el$13, () => logPreviewValue(value), null);
            return _el$13;
          })()
        }));
        return _el$;
      })(), (() => {
        var _el$2 = _tmpl$3$b(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling;
        insert(_el$3, () => t("log.details"));
        insert(_el$5, () => t("log.fields"));
        insert(_el$6, () => stringifyLogValue(fields(), 2));
        insert(_el$2, createComponent(Show, {
          get when() {
            return !!props.entry.raw;
          },
          get children() {
            var _el$7 = _tmpl$2$c(), _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling;
            insert(_el$8, () => t("log.raw"));
            insert(_el$9, () => props.entry.raw);
            return _el$7;
          }
        }), null);
        return _el$2;
      })()];
    }
  }), createComponent(Show, {
    get when() {
      return memo(() => items().length === 0)() && !!props.entry.raw;
    },
    get children() {
      var _el$0 = _tmpl$3$b(), _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
      insert(_el$1, () => t("log.details"));
      insert(_el$11, () => t("log.raw"));
      insert(_el$12, () => props.entry.raw);
      return _el$0;
    }
  })];
}
function LogLine(props) {
  return (() => {
    var _el$15 = _tmpl$7$7(), _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$18.firstChild, _el$21 = _el$19.nextSibling; _el$21.nextSibling; var _el$24 = _el$18.nextSibling, _el$25 = _el$16.nextSibling;
    insert(_el$17, () => logSourceLabel(props.entry.source));
    insert(_el$18, () => props.entry.level.toUpperCase(), _el$21);
    insert(_el$16, createComponent(Show, {
      get when() {
        return !!props.entry.delta;
      },
      get children() {
        var _el$22 = _tmpl$5$a();
        insert(_el$22, () => props.entry.delta);
        return _el$22;
      }
    }), _el$24);
    insert(_el$16, createComponent(Show, {
      get when() {
        return !!props.entry.service;
      },
      get children() {
        var _el$23 = _tmpl$6$8();
        insert(_el$23, () => props.entry.service);
        return _el$23;
      }
    }), _el$24);
    insert(_el$24, () => props.entry.ts);
    insert(_el$25, () => props.entry.message || props.entry.raw || "");
    insert(_el$15, createComponent(LogEntryDetail, {
      get entry() {
        return props.entry;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$ = props.entry.source, _v$2 = props.entry.source, _v$3 = `log-level log-level-${props.entry.level}`;
      _v$ !== _p$.e && setAttribute(_el$15, "data-source", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$17, "data-source", _p$.t = _v$2);
      _v$3 !== _p$.a && className(_el$18, _p$.a = _v$3);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$15;
  })();
}
function LogViewer(props) {
  let dialogRef;
  const [loading, setLoading] = createSignal(false);
  const [serverLogsSeq, setServerLogsSeq] = createSignal(0);
  const entries = createMemo(() => {
    serverLogsSeq();
    return buildLogEntries(filteredLogEntries(), props.ndjsonEvents ?? [], appStore.logFilterLevel);
  });
  const refresh = async () => {
    setLoading(true);
    try {
      await loadServerLogs();
      setServerLogsSeq((value) => value + 1);
    } finally {
      setLoading(false);
    }
  };
  const handleCopy = async () => {
    const text = formatLogText(entries());
    if (!text) return;
    await copyText(text);
  };
  const handleClear = () => {
    setAppStore("logEntries", []);
    _serverLogLines = [];
    setServerLogsSeq((value) => value + 1);
  };
  const handleLevelChange = (e) => {
    const select = e.target;
    setAppStore("logFilterLevel", select.value);
  };
  onMount(async () => {
    if (props.open) {
      await refresh();
      dialogRef?.showModal();
    }
  });
  createEffect(() => {
    const dialog = dialogRef;
    if (!dialog) return;
    if (props.open) {
      void refresh().finally(() => {
        if (!dialog.open) dialog.showModal();
      });
      return;
    }
    if (dialog.open) dialog.close();
  });
  return (() => {
    var _el$26 = _tmpl$8$6(), _el$27 = _el$26.firstChild, _el$28 = _el$27.firstChild, _el$29 = _el$28.firstChild, _el$30 = _el$29.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.nextSibling, _el$34 = _el$33.nextSibling, _el$35 = _el$34.nextSibling, _el$36 = _el$35.nextSibling, _el$37 = _el$28.nextSibling;
    use((el) => dialogRef = el, _el$26);
    insert(_el$29, () => t("log.title"));
    _el$31.addEventListener("change", handleLevelChange);
    _el$32.$$click = () => void refresh();
    insert(_el$32, () => t("log.load_server"));
    _el$33.$$click = () => void refresh();
    insert(_el$33, () => t("common.refresh"));
    _el$34.$$click = () => void handleCopy();
    insert(_el$34, () => t("common.copy"));
    _el$35.$$click = handleClear;
    insert(_el$35, () => t("common.clear"));
    _el$36.$$click = () => {
      dialogRef?.close();
      props.onClose?.();
    };
    insert(_el$36, () => t("common.close"));
    use((el) => onCleanup(setupAutoScroll(el)), _el$37);
    insert(_el$37, createComponent(Show, {
      get when() {
        return entries().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$38 = _tmpl$9$4();
          insert(_el$38, () => t("log.empty"));
          return _el$38;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return entries();
          },
          fallback: null,
          children: (entry) => createComponent(LogLine, {
            entry
          })
        });
      }
    }));
    createRenderEffect((_p$) => {
      var _v$4 = t("log.filter_level"), _v$5 = loading(), _v$6 = loading(), _v$7 = loading() || entries().length === 0;
      _v$4 !== _p$.e && setAttribute(_el$31, "aria-label", _p$.e = _v$4);
      _v$5 !== _p$.t && (_el$32.disabled = _p$.t = _v$5);
      _v$6 !== _p$.a && (_el$33.disabled = _p$.a = _v$6);
      _v$7 !== _p$.o && (_el$34.disabled = _p$.o = _v$7);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    createRenderEffect(() => _el$31.value = appStore.logFilterLevel);
    return _el$26;
  })();
}
delegateEvents(["click"]);

var _tmpl$$c = /* @__PURE__ */ template(`<span class=tool-detail>`), _tmpl$2$b = /* @__PURE__ */ template(`<div class=msg-tool><span class=tool-icon></span><span class=tool-name></span><span class=tool-status>`), _tmpl$3$a = /* @__PURE__ */ template(`<div class=msg-tool-input>`), _tmpl$4$9 = /* @__PURE__ */ template(`<div class="msg-tool-code md-content">`), _tmpl$5$9 = /* @__PURE__ */ template(`<button class=msg-tool-expand>+<!> 行 · 展开全部`), _tmpl$6$7 = /* @__PURE__ */ template(`<div class=msg-tool-output>`), _tmpl$7$6 = /* @__PURE__ */ template(`<div class=msg-tool-error>`), _tmpl$8$5 = /* @__PURE__ */ template(`<article class="turn msg"data-role=user><div class=msg-head><span class=msg-role></span></div><div class=msg-bubble><div class=msg-body>`), _tmpl$9$3 = /* @__PURE__ */ template(`<span>`), _tmpl$0$2 = /* @__PURE__ */ template(`<article class="turn msg agent-card"data-role=assistant data-agent-stage=executor><div class=agent-card-header role=button tabindex=0><span class=agent-card-label></span><span class=agent-card-count></span><span class=agent-card-chevron aria-hidden=true>▼</span></div><div class=agent-card-body>`), _tmpl$1$1 = /* @__PURE__ */ template(`<span class="agent-card-badge agent-card-badge--running"title=Running><span class=agent-card-spinner>`), _tmpl$10$1 = /* @__PURE__ */ template(`<div class=msg-thinking-live><span class=msg-thinking-dot></span><span>`), _tmpl$11$1 = /* @__PURE__ */ template(`<div class=msg-patch>`), _tmpl$12$1 = /* @__PURE__ */ template(`<div class=coding-tab-root style=display:flex;flex-direction:column;height:100%;min-width:0><div class="chat-scroll coding-scroll"style="flex:1 1 auto;overflow:auto">`), _tmpl$13$1 = /* @__PURE__ */ template(`<div class=chat-empty>`);
function CodingTab(props) {
  const [store, setStore] = createStore({
    messages: [],
    sessionID: null,
    busy: false
  });
  const busy = () => store.busy;
  let abortController = null;
  props.onReady?.({
    send: (text) => void sendCodingMessage(text),
    stop: () => abortController?.abort(),
    busy
  });
  function handleCodingEvent(msgIndex, event) {
    if (event.type === "session") {
      setStore("sessionID", event.sessionID ?? null);
      return;
    }
    if (event.type === "delta") {
      const field = event.field ?? "text";
      const partID = event.partID;
      const delta = event.delta ?? "";
      const parts = store.messages[msgIndex]?.parts;
      if (!parts) return;
      if (field === "raw") {
        const partIdx2 = parts.findIndex((p) => p.type === "tool" && p._partID === partID);
        if (partIdx2 < 0) return;
        setStore("messages", msgIndex, "parts", partIdx2, "state", "raw", (prev) => (prev ?? "") + delta);
        return;
      }
      const partIdx = parts.findIndex((p) => (p.type === "text" || p.type === "reasoning") && p._partID === partID);
      if (partIdx >= 0) {
        setStore("messages", msgIndex, "parts", partIdx, "text", (prev) => (prev ?? "") + delta);
      } else {
        setStore("messages", msgIndex, "parts", produce((ps) => {
          ps.push({
            type: "text",
            text: delta,
            _partID: partID
          });
        }));
      }
      return;
    }
    if (event.type === "part") {
      const p = event.part;
      if (!p) return;
      if (p.type === "tool") {
        const parts = store.messages[msgIndex]?.parts;
        if (!parts) return;
        const partIdx = parts.findIndex((x) => x.type === "tool" && x._partID === p.id);
        if (partIdx >= 0) {
          setStore("messages", msgIndex, "parts", partIdx, "state", p.state);
          setStore("messages", msgIndex, "parts", partIdx, "tool", p.tool);
        } else {
          setStore("messages", msgIndex, "parts", produce((ps) => {
            ps.push({
              type: "tool",
              tool: p.tool,
              state: p.state ?? {
                status: "pending",
                input: {},
                raw: ""
              },
              _partID: p.id
            });
          }));
        }
        return;
      }
      if (p.type === "reasoning") {
        const parts = store.messages[msgIndex]?.parts;
        if (!parts) return;
        const partIdx = parts.findIndex((x) => x._partID === p.id);
        if (partIdx >= 0) {
          setStore("messages", msgIndex, "parts", partIdx, "type", "reasoning");
        } else {
          setStore("messages", msgIndex, "parts", produce((ps) => {
            ps.push({
              type: "reasoning",
              text: p.text ?? "",
              _partID: p.id
            });
          }));
        }
        return;
      }
      if (p.type === "patch") {
        const files = p.files ?? [];
        if (files.length === 0) return;
        const parts = store.messages[msgIndex]?.parts;
        if (!parts) return;
        const partIdx = parts.findIndex((x) => x._partID === p.id);
        if (partIdx >= 0) {
          setStore("messages", msgIndex, "parts", partIdx, "files", files);
        } else {
          setStore("messages", msgIndex, "parts", produce((ps) => {
            ps.push({
              type: "patch",
              files,
              _partID: p.id
            });
          }));
        }
        return;
      }
      return;
    }
    if (event.type === "error") {
      const errorText = event.error?.message ?? JSON.stringify(event.error);
      setStore("messages", msgIndex, "parts", produce((ps) => {
        ps.push({
          type: "text",
          text: `Error: ${errorText}`
        });
      }));
      return;
    }
    if (event.type === "done") {
      setStore("messages", msgIndex, "streaming", false);
    }
  }
  async function sendCodingMessage(text) {
    if (store.busy || !text.trim()) return;
    setStore("busy", true);
    setStore("messages", produce((msgs) => {
      msgs.push({
        role: "user",
        text
      });
      msgs.push({
        role: "assistant",
        parts: [],
        streaming: true
      });
    }));
    const assistantIndex = store.messages.length - 1;
    const controller = new AbortController();
    abortController = controller;
    try {
      const res = await fetch(apiUrl("coding/message/stream"), {
        method: "POST",
        headers: {
          ...apiHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          sessionID: store.sessionID ?? void 0
        }),
        signal: controller.signal
      });
      if (!res.ok || !res.body) throw new Error(`Coding stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const {
          done,
          value
        } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {
          stream: true
        });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            handleCodingEvent(assistantIndex, JSON.parse(line.slice(5).trim()));
          } catch {
          }
        }
      }
      if (buffer.startsWith("data:")) {
        try {
          handleCodingEvent(assistantIndex, JSON.parse(buffer.slice(5).trim()));
        } catch {
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        setStore("messages", assistantIndex, "parts", produce((ps) => {
          ps.push({
            type: "text",
            text: `Error: ${err?.message ?? String(err)}`
          });
        }));
      }
    } finally {
      setStore("messages", assistantIndex, "streaming", false);
      setStore("busy", false);
      abortController = null;
    }
  }
  onCleanup(() => {
    abortController?.abort();
  });
  const FILE_WRITE_TOOLS = /* @__PURE__ */ new Set(["write", "writefile"]);
  const FILE_EDIT_TOOLS = /* @__PURE__ */ new Set(["edit", "editfile", "applypatch"]);
  const FILE_READ_TOOLS = /* @__PURE__ */ new Set(["read", "readfile"]);
  function isFileContentTool(key) {
    return FILE_WRITE_TOOLS.has(key) || FILE_EDIT_TOOLS.has(key) || FILE_READ_TOOLS.has(key);
  }
  function extractFilePath(inp) {
    return inp?.file_path ?? inp?.filePath ?? inp?.path ?? inp?.filename ?? "";
  }
  function extractCodeContent(key, inp, out) {
    if (FILE_WRITE_TOOLS.has(key)) return inp?.content ?? inp?.text ?? "";
    if (FILE_EDIT_TOOLS.has(key)) {
      const oldStr = inp?.old_string ?? "";
      const newStr = inp?.new_string ?? "";
      if (oldStr && newStr) return `--- old
${oldStr}
--- new
${newStr}`;
      return newStr || (inp?.content ?? "");
    }
    if (FILE_READ_TOOLS.has(key)) return out;
    return "";
  }
  function CodingToolView(pProps) {
    const status = () => pProps.part.state?.status ?? "running";
    const toolName = () => pProps.part.tool || "tool";
    const input = () => pProps.part.state?.input ?? {};
    const detail = () => {
      const raw2 = displayToolDetail(toolName(), input(), pProps.part.state ?? {}, activeDirectory$1());
      return raw2 && raw2.toLowerCase() !== toolName().toLowerCase() ? raw2 : "";
    };
    const raw = () => pProps.part.state?.raw || "";
    const output = () => stripAnsi(pProps.part.state?.output || "");
    const error = () => stripAnsi(pProps.part.state?.error || "") || output();
    const partKey = () => pProps.part._partID || toolName();
    const isExpanded = () => toolOutputExpanded(partKey());
    const key = () => toolNameKey(toolName());
    const codeResult = createMemo(() => {
      if (status() !== "completed") return null;
      const k = key();
      if (!isFileContentTool(k)) return null;
      const content = extractCodeContent(k, input(), output());
      if (!content) return null;
      const lang = extToLang(extractFilePath(input()));
      return renderCodeBlock(content, lang, isExpanded() ? Infinity : 100);
    });
    return [(() => {
      var _el$ = _tmpl$2$b(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$5 = _el$3.nextSibling;
      insert(_el$2, () => displayToolIcon(toolName()));
      insert(_el$3, toolName);
      insert(_el$, createComponent(Show, {
        get when() {
          return detail();
        },
        get children() {
          var _el$4 = _tmpl$$c();
          insert(_el$4, detail);
          return _el$4;
        }
      }), _el$5);
      insert(_el$5, () => toolStatusLabel(status()));
      createRenderEffect((_p$) => {
        var _v$ = status(), _v$2 = toolStatusLabel(status());
        _v$ !== _p$.e && setAttribute(_el$5, "data-status", _p$.e = _v$);
        _v$2 !== _p$.t && setAttribute(_el$5, "title", _p$.t = _v$2);
        return _p$;
      }, {
        e: void 0,
        t: void 0
      });
      return _el$;
    })(), createComponent(Show, {
      get when() {
        return memo(() => status() === "pending")() && raw();
      },
      get children() {
        var _el$6 = _tmpl$3$a();
        insert(_el$6, raw);
        return _el$6;
      }
    }), createComponent(Show, {
      get when() {
        return codeResult();
      },
      get children() {
        return [(() => {
          var _el$7 = _tmpl$4$9();
          createRenderEffect(() => _el$7.innerHTML = codeResult().html);
          return _el$7;
        })(), createComponent(Show, {
          get when() {
            return codeResult().truncated;
          },
          get children() {
            var _el$8 = _tmpl$5$9(), _el$9 = _el$8.firstChild, _el$1 = _el$9.nextSibling; _el$1.nextSibling;
            _el$8.$$click = () => toggleToolOutputExpanded(partKey());
            insert(_el$8, () => codeResult().totalLines - 100, _el$1);
            return _el$8;
          }
        })];
      }
    }), createComponent(Show, {
      get when() {
        return memo(() => !!(status() === "completed" && output()))() && !codeResult();
      },
      get children() {
        var _el$10 = _tmpl$6$7();
        _el$10.$$click = () => toggleToolOutputExpanded(partKey());
        insert(_el$10, output);
        createRenderEffect(() => _el$10.classList.toggle("msg-tool-output--expanded", !!isExpanded()));
        return _el$10;
      }
    }), createComponent(Show, {
      get when() {
        return memo(() => status() === "error")() && error();
      },
      get children() {
        var _el$11 = _tmpl$7$6();
        insert(_el$11, error);
        return _el$11;
      }
    })];
  }
  function UserMessageView(mProps) {
    return (() => {
      var _el$12 = _tmpl$8$5(), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild, _el$15 = _el$13.nextSibling, _el$16 = _el$15.firstChild;
      insert(_el$14, () => t("chat.role.user"));
      insert(_el$16, createComponent(StaticTextPart, {
        get text() {
          return mProps.msg.text;
        }
      }));
      return _el$12;
    })();
  }
  function AssistantMessageView(mProps) {
    const cardKey = () => `coding:${mProps.index}`;
    const isStreaming = () => mProps.msg.streaming;
    const expanded = () => agentCardExpanded(cardKey(), isStreaming());
    const toggle = () => toggleAgentCardExpanded(cardKey(), isStreaming());
    const hasParts = createMemo(() => mProps.msg.parts.length > 0);
    const hasError = createMemo(() => mProps.msg.parts.some((p) => p.type === "text" && p.text.startsWith("Error:")));
    const toolCount = createMemo(() => mProps.msg.parts.filter((p) => p.type === "tool").length);
    return (() => {
      var _el$17 = _tmpl$0$2(), _el$18 = _el$17.firstChild, _el$20 = _el$18.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$18.nextSibling;
      _el$18.$$keydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      };
      _el$18.$$click = toggle;
      insert(_el$18, createComponent(Show, {
        get when() {
          return !isStreaming();
        },
        get fallback() {
          return _tmpl$1$1();
        },
        get children() {
          var _el$19 = _tmpl$9$3();
          insert(_el$19, () => hasError() ? "✗" : "✓");
          createRenderEffect((_p$) => {
            var _v$3 = hasError() ? "agent-card-badge agent-card-badge--error" : "agent-card-badge agent-card-badge--done", _v$4 = hasError() ? "Error" : "Done";
            _v$3 !== _p$.e && className(_el$19, _p$.e = _v$3);
            _v$4 !== _p$.t && setAttribute(_el$19, "title", _p$.t = _v$4);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$19;
        }
      }), _el$20);
      insert(_el$20, () => agentStageLabel("executor"));
      insert(_el$21, createComponent(Show, {
        get when() {
          return toolCount() > 0;
        },
        get children() {
          return ["(", memo(() => toolCount()), ")"];
        }
      }));
      use((el) => onCleanup(setupAutoScroll(el)), _el$22);
      insert(_el$22, createComponent(Show, {
        get when() {
          return hasParts();
        },
        get fallback() {
          return createComponent(Show, {
            get when() {
              return isStreaming();
            },
            get children() {
              var _el$24 = _tmpl$10$1(), _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling;
              insert(_el$26, () => t("chat.thinking"));
              return _el$24;
            }
          });
        },
        get children() {
          return createComponent(For, {
            get each() {
              return mProps.msg.parts;
            },
            children: (part) => createComponent(Switch, {
              fallback: null,
              get children() {
                return [createComponent(Match, {
                  get when() {
                    return memo(() => part.type === "text")() && part.text.trim();
                  },
                  get children() {
                    return createComponent(TextPart, {
                      get text() {
                        return part.text;
                      }
                    });
                  }
                }), createComponent(Match, {
                  get when() {
                    return memo(() => !!(part.type === "reasoning" && part.text.trim()))() && !isEmptyReasoning(part.text);
                  },
                  get children() {
                    return createComponent(ReasoningPart, {
                      part
                    });
                  }
                }), createComponent(Match, {
                  get when() {
                    return part.type === "tool";
                  },
                  get children() {
                    return createComponent(CodingToolView, {
                      part
                    });
                  }
                }), createComponent(Match, {
                  get when() {
                    return memo(() => part.type === "patch")() && part.files.length > 0;
                  },
                  get children() {
                    var _el$27 = _tmpl$11$1();
                    insert(_el$27, () => "⚙ " + part.files.map((f) => shortRelativePath(f, activeDirectory$1())).join(", "));
                    return _el$27;
                  }
                })];
              }
            })
          });
        }
      }));
      createRenderEffect((_p$) => {
        var _v$5 = !!expanded(), _v$6 = expanded(), _v$7 = !expanded();
        _v$5 !== _p$.e && _el$17.classList.toggle("agent-card--expanded", _p$.e = _v$5);
        _v$6 !== _p$.t && setAttribute(_el$18, "aria-expanded", _p$.t = _v$6);
        _v$7 !== _p$.a && _el$22.classList.toggle("agent-card-body--preview", _p$.a = _v$7);
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0
      });
      return _el$17;
    })();
  }
  const isEmpty = createMemo(() => store.messages.length === 0);
  return (() => {
    var _el$28 = _tmpl$12$1(), _el$29 = _el$28.firstChild;
    use((el) => onCleanup(setupAutoScroll(el)), _el$29);
    insert(_el$29, createComponent(Show, {
      get when() {
        return !isEmpty();
      },
      get fallback() {
        return (() => {
          var _el$30 = _tmpl$13$1();
          insert(_el$30, () => t("coding.empty"));
          return _el$30;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return store.messages;
          },
          children: (msg, idx) => createComponent(Show, {
            get when() {
              return msg.role === "user";
            },
            get fallback() {
              return createComponent(AssistantMessageView, {
                msg,
                get index() {
                  return idx();
                }
              });
            },
            get children() {
              return createComponent(UserMessageView, {
                msg
              });
            }
          })
        });
      }
    }));
    return _el$28;
  })();
}
delegateEvents(["click", "keydown"]);

var _tmpl$$b = /* @__PURE__ */ template(`<span class=diff-preview-meta><span class=change-status></span><span class=diff-dialog-stat data-tone=add>+</span><span class=diff-dialog-stat data-tone=del>-`), _tmpl$2$a = /* @__PURE__ */ template(`<header class=diff-preview-head><span class=diff-preview-path>`), _tmpl$3$9 = /* @__PURE__ */ template(`<div class=diff-preview-body>`), _tmpl$4$8 = /* @__PURE__ */ template(`<div class=diff-preview-panel>`), _tmpl$5$8 = /* @__PURE__ */ template(`<div class=diff-preview-empty><p class=empty-hint>`);
function DiffPreviewPanel(props) {
  const [change] = createResource(() => props.filePath || "", async (path) => {
    if (!path) return null;
    return resolveDiff(path);
  });
  const item = createMemo(() => change());
  const loading = () => change.loading;
  return (() => {
    var _el$ = _tmpl$4$8();
    insert(_el$, createComponent(Show, {
      get when() {
        return props.filePath;
      },
      get fallback() {
        return (() => {
          var _el$1 = _tmpl$5$8(), _el$10 = _el$1.firstChild;
          insert(_el$10, () => t("diff.select_file"));
          return _el$1;
        })();
      },
      get children() {
        return [(() => {
          var _el$2 = _tmpl$2$a(), _el$3 = _el$2.firstChild;
          insert(_el$3, () => props.filePath);
          insert(_el$2, createComponent(Show, {
            get when() {
              return item();
            },
            get children() {
              var _el$4 = _tmpl$$b(), _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling; _el$6.firstChild; var _el$8 = _el$6.nextSibling; _el$8.firstChild;
              insert(_el$5, () => changeStatusLabel(item().status));
              insert(_el$6, () => item().additions, null);
              insert(_el$8, () => item().deletions, null);
              createRenderEffect(() => setAttribute(_el$5, "data-status", item().status));
              return _el$4;
            }
          }), null);
          createRenderEffect(() => setAttribute(_el$3, "title", props.filePath || ""));
          return _el$2;
        })(), (() => {
          var _el$0 = _tmpl$3$9();
          insert(_el$0, createComponent(Show, {
            get when() {
              return !loading();
            },
            get fallback() {
              return (() => {
                var _el$11 = _tmpl$5$8(), _el$12 = _el$11.firstChild;
                insert(_el$12, () => t("diff.loading"));
                return _el$11;
              })();
            },
            get children() {
              return createComponent(Show, {
                get when() {
                  return item();
                },
                get fallback() {
                  return (() => {
                    var _el$13 = _tmpl$5$8(), _el$14 = _el$13.firstChild;
                    insert(_el$14, () => t("diff.no_preview"));
                    return _el$13;
                  })();
                },
                get children() {
                  return createComponent(DiffView, {
                    get item() {
                      return item();
                    }
                  });
                }
              });
            }
          }));
          return _el$0;
        })()];
      }
    }));
    return _el$;
  })();
}

var _tmpl$$a = /* @__PURE__ */ template(`<header class=file-view-head><span class=file-view-path>`), _tmpl$2$9 = /* @__PURE__ */ template(`<div class=file-view-body>`), _tmpl$3$8 = /* @__PURE__ */ template(`<div class=file-view-panel>`), _tmpl$4$7 = /* @__PURE__ */ template(`<div class=file-view-empty><p class=empty-hint>`), _tmpl$5$7 = /* @__PURE__ */ template(`<div class=file-view-content>`);
async function fetchFileContent(path) {
  return await apiJson(`/file/content?path=${encodeURIComponent(path)}`);
}
function FileViewPanel(props) {
  const [file] = createResource(() => props.filePath || "", async (path) => {
    if (!path) return null;
    return fetchFileContent(path);
  });
  const loading = () => file.loading;
  const err = () => file.error;
  return (() => {
    var _el$ = _tmpl$3$8();
    insert(_el$, createComponent(Show, {
      get when() {
        return props.filePath;
      },
      get fallback() {
        return (() => {
          var _el$5 = _tmpl$4$7(), _el$6 = _el$5.firstChild;
          insert(_el$6, () => t("workspace.file_empty"));
          return _el$5;
        })();
      },
      get children() {
        return [(() => {
          var _el$2 = _tmpl$$a(), _el$3 = _el$2.firstChild;
          insert(_el$3, () => props.filePath);
          createRenderEffect(() => setAttribute(_el$3, "title", props.filePath || ""));
          return _el$2;
        })(), (() => {
          var _el$4 = _tmpl$2$9();
          insert(_el$4, createComponent(Show, {
            get when() {
              return !loading();
            },
            get fallback() {
              return (() => {
                var _el$7 = _tmpl$4$7(), _el$8 = _el$7.firstChild;
                insert(_el$8, () => t("workspace.file_loading"));
                return _el$7;
              })();
            },
            get children() {
              return createComponent(Show, {
                get when() {
                  return !err();
                },
                get fallback() {
                  return (() => {
                    var _el$9 = _tmpl$4$7(), _el$0 = _el$9.firstChild;
                    insert(_el$0, () => t("workspace.file_error", {
                      message: err()?.message ?? ""
                    }));
                    return _el$9;
                  })();
                },
                get children() {
                  return createComponent(Show, {
                    get when() {
                      return memo(() => !!file())() && file().type === "text";
                    },
                    get fallback() {
                      return (() => {
                        var _el$1 = _tmpl$4$7(), _el$10 = _el$1.firstChild;
                        insert(_el$10, () => t("workspace.file_binary"));
                        return _el$1;
                      })();
                    },
                    get children() {
                      return createComponent(FileBody, {
                        get path() {
                          return props.filePath;
                        },
                        get content() {
                          return file().content;
                        }
                      });
                    }
                  });
                }
              });
            }
          }));
          return _el$4;
        })()];
      }
    }));
    return _el$;
  })();
}
function FileBody(props) {
  const rendered = () => {
    const lang = extToLang(props.path);
    return renderCodeBlock(props.content, lang, Number.MAX_SAFE_INTEGER).html;
  };
  return (() => {
    var _el$11 = _tmpl$5$7();
    createRenderEffect(() => _el$11.innerHTML = rendered());
    return _el$11;
  })();
}

var _tmpl$$9 = /* @__PURE__ */ template(`<span class=workspace-tab-file> · `), _tmpl$2$8 = /* @__PURE__ */ template(`<section class=workspace id=workspacePanel><header class=workspace-header><div class=workspace-tabs role=tablist><button type=button class=workspace-tab role=tab><span class=workspace-tab-label></span></button><button type=button class=workspace-tab role=tab><span class=workspace-tab-label></span></button><button type=button class=workspace-tab role=tab><span class=workspace-tab-label></span></button></div><button type=button class=workspace-close>×</button></header><div class=workspace-body><div class=workspace-view data-kind=build></div><div class=workspace-view data-kind=diff></div><div class=workspace-view data-kind=file>`);
function WorkspacePanel(props) {
  const isBuild = () => props.view.kind === "build";
  const isDiff = () => props.view.kind === "diff";
  const isFile = () => props.view.kind === "file";
  const diffFilePath = () => props.view.kind === "diff" ? props.view.filePath : null;
  const fileFilePath = () => props.view.kind === "file" ? props.view.filePath : null;
  function selectBuild() {
    if (props.view.kind !== "build") props.onSelectView({
      kind: "build"
    });
  }
  function selectDiff() {
    if (props.view.kind !== "diff") {
      props.onSelectView({
        kind: "diff",
        filePath: ""
      });
    }
  }
  function selectFile() {
    if (props.view.kind !== "file") {
      props.onSelectView({
        kind: "file",
        filePath: ""
      });
    }
  }
  return (() => {
    var _el$ = _tmpl$2$8(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$4.nextSibling, _el$7 = _el$6.firstChild, _el$0 = _el$6.nextSibling, _el$1 = _el$0.firstChild, _el$12 = _el$3.nextSibling, _el$13 = _el$2.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.nextSibling;
    _el$4.$$click = selectBuild;
    insert(_el$5, () => t("workspace.build"));
    _el$6.$$click = selectDiff;
    insert(_el$7, () => t("workspace.diff"), null);
    insert(_el$7, createComponent(Show, {
      get when() {
        return diffFilePath();
      },
      get children() {
        var _el$8 = _tmpl$$9(); _el$8.firstChild;
        insert(_el$8, () => shortFileName(diffFilePath() || ""), null);
        return _el$8;
      }
    }), null);
    _el$0.$$click = selectFile;
    insert(_el$1, () => t("workspace.file"), null);
    insert(_el$1, createComponent(Show, {
      get when() {
        return fileFilePath();
      },
      get children() {
        var _el$10 = _tmpl$$9(); _el$10.firstChild;
        insert(_el$10, () => shortFileName(fileFilePath() || ""), null);
        return _el$10;
      }
    }), null);
    addEventListener(_el$12, "click", props.onClose, true);
    insert(_el$14, createComponent(CodingTab, {
      get active() {
        return isBuild();
      },
      get onReady() {
        return props.onCodingReady;
      }
    }));
    insert(_el$15, createComponent(DiffPreviewPanel, {
      get filePath() {
        return diffFilePath();
      }
    }));
    insert(_el$16, createComponent(FileViewPanel, {
      get filePath() {
        return fileFilePath();
      }
    }));
    createRenderEffect((_p$) => {
      var _v$ = isBuild(), _v$2 = isBuild() ? "true" : "false", _v$3 = isDiff(), _v$4 = isDiff() ? "true" : "false", _v$5 = isFile(), _v$6 = isFile() ? "true" : "false", _v$7 = t("workspace.close"), _v$8 = t("workspace.close"), _v$9 = isBuild() ? "flex" : "none", _v$0 = isDiff() ? "flex" : "none", _v$1 = isFile() ? "flex" : "none";
      _v$ !== _p$.e && setAttribute(_el$4, "aria-selected", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$4, "data-active", _p$.t = _v$2);
      _v$3 !== _p$.a && setAttribute(_el$6, "aria-selected", _p$.a = _v$3);
      _v$4 !== _p$.o && setAttribute(_el$6, "data-active", _p$.o = _v$4);
      _v$5 !== _p$.i && setAttribute(_el$0, "aria-selected", _p$.i = _v$5);
      _v$6 !== _p$.n && setAttribute(_el$0, "data-active", _p$.n = _v$6);
      _v$7 !== _p$.s && setAttribute(_el$12, "title", _p$.s = _v$7);
      _v$8 !== _p$.h && setAttribute(_el$12, "aria-label", _p$.h = _v$8);
      _v$9 !== _p$.r && setStyleProperty(_el$14, "display", _p$.r = _v$9);
      _v$0 !== _p$.d && setStyleProperty(_el$15, "display", _p$.d = _v$0);
      _v$1 !== _p$.l && setStyleProperty(_el$16, "display", _p$.l = _v$1);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0,
      d: void 0,
      l: void 0
    });
    return _el$;
  })();
}
function shortFileName(path) {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}
delegateEvents(["click"]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function hasTauriRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function";
}
async function tauriInvoke$1(command, args) {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    return globalInvoke(command, args);
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}
function normalizeUrl(value, fallback) {
  const input = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return input.replace(/\/+$/, "");
}
function isManagedLocalServerUrl(value) {
  const input = typeof value === "string" && value.trim() ? value.trim() : settingsStore.serverUrl;
  try {
    const url = new URL(input);
    return url.protocol.startsWith("http") && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}
function usesManagedLocalServer() {
  return settingsStore.autoServer && isManagedLocalServerUrl(settingsStore.serverUrl);
}
async function localServerInfo() {
  if (!hasTauriRuntime()) return null;
  const info = await tauriInvoke$1("overlay_server_info").catch(
    () => void 0
  );
  return info && typeof info.url === "string" ? info : null;
}
async function syncLocalServerUrl(options = {}) {
  if (!hasTauriRuntime()) return null;
  if (!options.force && !usesManagedLocalServer()) return null;
  const info = await localServerInfo();
  if (!info) return null;
  const next = normalizeUrl(info.url, settingsStore.serverUrl);
  if (normalizeUrl(settingsStore.serverUrl, settingsStore.serverUrl) === next) {
    return info;
  }
  applySettings({ ...settingsStore, serverUrl: next });
  saveSettings();
  configure({ serverUrl: next });
  return info;
}
async function checkConnection() {
  const managed = usesManagedLocalServer();
  if (managed) {
    await syncLocalServerUrl();
  }
  setConnectionStatus("connecting");
  const attempts = managed ? 8 : 1;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      await apiJson("global/health", { signal: AbortSignal.timeout(5e3) });
      setConnectionStatus("online");
      return true;
    } catch (e) {
      lastError = e;
      if (i >= attempts - 1) break;
      await wait(350);
      await syncLocalServerUrl();
    }
  }
  setConnectionStatus("offline");
  console.warn("[connection] connection failed", String(lastError));
  return false;
}
let _monitorTimer = null;
function startConnectionMonitor(onReconnect, intervalMs = 1e4) {
  stopConnectionMonitor();
  _monitorTimer = setInterval(async () => {
    try {
      if (!appStore.connected) {
        const ok = await checkConnection();
        if (ok) {
          await onReconnect?.();
        }
      }
    } catch (err) {
      console.warn("[connection] monitor retry failed", err);
    }
  }, intervalMs);
}
function stopConnectionMonitor() {
  if (_monitorTimer !== null) {
    clearInterval(_monitorTimer);
    _monitorTimer = null;
  }
}

const connection = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  checkConnection,
  localServerInfo,
  startConnectionMonitor,
  stopConnectionMonitor,
  syncLocalServerUrl
}, Symbol.toStringTag, { value: 'Module' }));

async function loadExtensions() {
  try {
    const [skills, mcp] = await Promise.all([
      apiJson("skill/installed").catch(() => apiJson("skill")),
      apiJson("mcp")
    ]);
    setSkills(Array.isArray(skills) ? skills : []);
    setMcp(mcp && typeof mcp === "object" ? mcp : {});
  } catch (e) {
    AppLog.debug("extensions", "loadExtensions failed, resetting to empty", {
      error: String(e)
    });
    setSkills([]);
    setMcp({});
  }
}
async function loadSkillMarket() {
  try {
    const items = await apiJson("skill/market");
    setSkillMarket(Array.isArray(items) ? items : []);
  } catch (e) {
    AppLog.error("ui", "Failed to load skill market", { error: String(e) });
    setSkillMarket([]);
  }
}

const extensions = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  loadExtensions,
  loadSkillMarket
}, Symbol.toStringTag, { value: 'Module' }));

function executorInfo(value) {
  return appStore.executors.find((item) => item.id === value);
}
function executorSelectable(value) {
  const item = executorInfo(value);
  if (item) return !!item.selectable;
  return value === "opencode";
}
function executorCurrentModel(executorID) {
  const info = executorInfo(executorID);
  return info?.model ?? "";
}
async function loadExecutors() {
  try {
    const data = await apiJson("executor");
    setExecutors(Array.isArray(data) ? data : []);
  } catch (e) {
    AppLog.debug("executor", "loadExecutors failed, resetting to empty", {
      error: String(e)
    });
    setExecutors([]);
  }
}
async function setExecutorModel(executorID, model) {
  try {
    await apiJson(`executor/${encodeURIComponent(executorID)}/model`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });
    await loadExecutors();
  } catch (e) {
    AppLog.error("ui", "Failed to set executor model", {
      error: String(e),
      executorID,
      model
    });
  }
}

const executor = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  executorCurrentModel,
  executorInfo,
  executorSelectable,
  loadExecutors,
  setExecutorModel
}, Symbol.toStringTag, { value: 'Module' }));

function syncApiConfig() {
  configure({
    serverUrl: settingsStore.serverUrl,
    username: settingsStore.username,
    password: settingsStore.password,
    directory: settingsStore.directory
  });
}
async function loadInitialData() {
  await ensureDefaultDirectory().catch(() => false);
  await ensureWorkspaceDirectory().catch(() => settingsStore.directory || "");
  syncApiConfig();
  await Promise.all([
    loadTasks(),
    loadMeta(),
    loadExtensions(),
    loadConfigInfo(),
    loadExecutors()
  ]);
}
async function initApp(options = {}) {
  const {
    onConnected,
    onReconnect,
    reconnectInterval = 1e4
  } = options;
  loadSettings();
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    const nativeSettings = await invoke("overlay_settings_load").catch(() => null);
    if (nativeSettings && typeof nativeSettings === "object" && !Array.isArray(nativeSettings)) {
      applySettings(nativeSettings);
      setSavedDirectory(
        savedDirectoryValue$1(
          nativeSettings.directory,
          nativeSettings.directoryMode
        )
      );
    }
  }
  syncApiConfig();
  await loadAllLocales();
  await setLocale(settingsStore.locale);
  const connected = await checkConnection();
  if (connected) {
    await loadInitialData();
    await restoreInitialWorkspace();
    await onConnected?.();
  }
  stopConnectionMonitor();
  startConnectionMonitor(async () => {
    syncApiConfig();
    await loadInitialData();
    await restoreInitialWorkspace();
    await onReconnect?.();
  }, reconnectInterval);
}
function teardownApp() {
  stopConnectionMonitor();
}
async function loadConfigInfo() {
  try {
    const [config, catalog, auth, channels, prompts] = await Promise.all([
      apiJson("config"),
      apiJson("provider"),
      apiJson("provider/auth"),
      apiJson("channel"),
      apiJson("config/prompt").catch(() => [])
    ]);
    setAppStore({
      config: config ?? null,
      providerCatalog: catalog ?? null,
      providerAuth: auth ?? null,
      channels: Array.isArray(channels) ? channels : [],
      promptEntries: Array.isArray(prompts) ? prompts : []
    });
    const remoteTP = config?.tool_permissions;
    if (remoteTP && typeof remoteTP === "object") {
      const def = DEFAULT_SETTINGS.toolPermissions;
      const merged = {
        websearch: remoteTP.websearch ?? def.websearch,
        webfetch: remoteTP.webfetch ?? def.webfetch,
        skill: remoteTP.skill ?? def.skill,
        external_directory: remoteTP.external_directory ?? def.external_directory,
        task: remoteTP.task ?? def.task,
        schedule: remoteTP.schedule ?? def.schedule
      };
      setSettingsStore("toolPermissions", merged);
    }
  } catch (e) {
    console.warn("[init] loadConfigInfo failed", e);
  }
}
async function restoreInitialWorkspace() {
  const { workspaceTaskID, workspaceDirectory, directory: activeDir } = settingsStore;
  const tasks = boardStore.tasks;
  if (settingsStore.workspaceEpoch > 0) return false;
  const base = activeDir || "";
  const taskID = workspaceTaskID || "";
  const directory = workspaceRestoreDirectory(workspaceDirectory || "");
  const moved = !!directory && !!base && directory !== base;
  if (moved) {
    setSettingsStore("directory", directory);
    bumpDirectoryEpoch();
  }
  if (taskID && tasks.some((item) => item?.task?.id === taskID)) {
    if (boardStore.selectedTaskID !== taskID || !boardStore.board) {
      await selectTask(taskID);
    }
    bumpWorkspaceEpoch();
    return true;
  }
  if (moved) {
    setSettingsStore("directory", base);
    bumpDirectoryEpoch();
  }
  return false;
}

const init = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  initApp,
  loadConfigInfo,
  restoreInitialWorkspace,
  teardownApp
}, Symbol.toStringTag, { value: 'Module' }));

function sameBudget(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
function budgetNumber(input, options = {}) {
  const text = input?.value?.trim() || "";
  if (!text) return void 0;
  const value = Number(text);
  if (!Number.isFinite(value)) return void 0;
  if (options.allowZero ? value < 0 : value <= 0) return void 0;
  return Math.round(value * (options.scale || 1));
}
function draftBudget() {
  const budget = {
    maxRuns: budgetNumber(
      document.getElementById("budgetMaxRuns")
    ),
    maxExecutorGroups: budgetNumber(
      document.getElementById("budgetMaxExecutorGroups")
    )
  };
  if (Object.values(budget).every((v) => v === void 0)) return void 0;
  return budget;
}

function currentTaskSessionID() {
  return boardStore.board?.task?.sessionID || boardStore.tasks.find(
    (item) => item?.task?.id === boardStore.selectedTaskID
  )?.task?.sessionID || "";
}
function canComposeChat() {
  if (!appStore.connected) return false;
  const mode = workspaceMode();
  return mode === "empty" || mode === "task";
}
function chatAbortTargets(seed) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (target) => {
    if (!target) return;
    const key = target.kind === "run" ? `run:${target.runID}` : target.kind === "session" ? `session:${target.sessionID}` : target.kind === "task" ? `task:${target.taskID}` : "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(target);
  };
  push(seed);
  if (!boardStore.selectedTaskID) return items;
  const runID = boardStore.board?.task?.activeRunID || "";
  if (runID) {
    push({ kind: "run", runID });
  }
  const sessionID = currentTaskSessionID();
  if (sessionID) {
    push({ kind: "session", sessionID });
  }
  push({ kind: "task", taskID: boardStore.selectedTaskID });
  return items;
}
async function abortChatTargetRemote(target) {
  if (!target) return false;
  if (target.kind === "run" && target.runID) {
    await apiJson(`run/${encodeURIComponent(target.runID)}/abort`, {
      method: "POST"
    });
    return true;
  }
  if (target.kind === "task" && target.taskID) {
    await apiJson(`task/${encodeURIComponent(target.taskID)}/cancel`, {
      method: "POST"
    });
    return true;
  }
  if (target.kind === "session" && target.sessionID) {
    await apiJson(`session/${encodeURIComponent(target.sessionID)}/abort`, {
      method: "POST"
    });
    return true;
  }
  return false;
}
async function stopChatRequest(options = {}) {
  const request = store.chatRequest;
  if (!request || request.stopping) return false;
  request.aborted = true;
  request.manualAbort = options.manual !== false;
  request.stopping = true;
  request.recovery?.stop();
  request.controller?.abort?.();
  abortChatRequest();
  if (options.remote === false) return true;
  const targets = chatAbortTargets(request.target);
  if (targets.length === 0) return true;
  try {
    for (const target of targets) {
      try {
        await abortChatTargetRemote(target);
        return true;
      } catch (e) {
        console.warn("[stopChatRequest] Failed to abort target", {
          error: String(e),
          target
        });
      }
    }
    return false;
  } finally {
    request.stopping = false;
  }
}
function mergeMessages(left, right) {
  return mergeLoadedConversationMessages(left, right);
}
function insertPendingUserMessage(requestID, text) {
  setMessages([
    ...store.messages,
    {
      info: { id: `pending-user:${requestID}`, role: "user", time: { created: Date.now() } },
      parts: [{ type: "text", text }]
    }
  ]);
}
async function panelMessage(text, attachmentsOrMeta = [], metadata = {}) {
  const attachments = Array.isArray(attachmentsOrMeta) ? attachmentsOrMeta : [];
  const meta = Array.isArray(attachmentsOrMeta) ? metadata : attachmentsOrMeta;
  const requestID = crypto.randomUUID();
  const controller = new AbortController();
  const request = {
    requestID,
    controller,
    stopping: false,
    aborted: false,
    manualAbort: false
  };
  insertPendingUserMessage(requestID, text);
  setConnectionStatus("online");
  setChatRequest(request);
  try {
    if (!boardStore.selectedTaskID) {
      const taskID = await createTask({
        text,
        attachments,
        metadata: meta,
        signal: controller.signal,
        budget: draftBudget()
      });
      if (taskID) {
        await selectTask(taskID);
        return { task_id: taskID };
      }
      throw new Error("Task creation returned no task_id");
    }
    const taskStatus = boardStore.board?.task?.status;
    if (taskStatus === "completed") {
      const taskID = await createTask({
        text,
        attachments,
        metadata: meta,
        signal: controller.signal,
        budget: draftBudget()
      });
      if (taskID) {
        await selectTask(taskID);
        return { task_id: taskID };
      }
      throw new Error("Task creation returned no task_id");
    }
    const result = await apiJson(
      `task/${encodeURIComponent(boardStore.selectedTaskID)}/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "panel" }),
        signal: controller.signal
      }
    );
    await loadBoard();
    if (result?.message) {
      setMessages(
        mergeMessages(store.messages, [
          syntheticTextMessage("assistant", Date.now(), String(result.message))
        ])
      );
    }
    return result;
  } catch (error) {
    if (request.manualAbort) throw error;
    throw error;
  } finally {
    if (store.chatRequest?.requestID === request.requestID) {
      setChatRequest(null);
    }
  }
}

function createOverlayInteractions(deps) {
  let busy = false;
  let pendingInteraction = null;
  const autoResolveFailed = /* @__PURE__ */ new Map();
  const api = deps.apiJson ?? apiJson;
  const logger = deps.AppLog ?? AppLog;
  function stateFlag(name, fallback) {
    const value = deps.state?.[name];
    return typeof value === "boolean" ? value : fallback;
  }
  function autoPermissionReplyAction() {
    const value = deps.state?.autoPermissionReply;
    if (value === "always") return "always";
    return "once";
  }
  function interactionActions(interaction) {
    if (interaction.type === "permission") {
      return `<button class="btn btn-primary" data-action="always" title="${deps.escapeHtml(deps.t("interaction.always_allow_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.always_allow_title"))}">${deps.escapeHtml(deps.t("interaction.always_allow"))}</button>
         <button class="btn btn-ghost" data-action="once" title="${deps.escapeHtml(deps.t("interaction.allow_once_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.allow_once_title"))}">${deps.escapeHtml(deps.t("interaction.allow_once"))}</button>
         <button class="btn btn-ghost" data-action="reject" title="${deps.escapeHtml(deps.t("interaction.reject_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.reject_title"))}">${deps.escapeHtml(deps.t("interaction.reject"))}</button>`;
    }
    return `<button class="btn btn-primary" data-action="answer" title="${deps.escapeHtml(deps.t("interaction.answer_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.answer_title"))}">${deps.escapeHtml(deps.t("interaction.answer"))}</button>
         <button class="btn btn-ghost" data-action="reject" title="${deps.escapeHtml(deps.t("interaction.skip_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.skip_title"))}">${deps.escapeHtml(deps.t("interaction.skip"))}</button>`;
  }
  function interactionIcon(interaction) {
    return interaction.type === "permission" ? "🔒" : "❓";
  }
  function interactionAlertHtml(interaction) {
    return `<div class="interaction-alert" data-id="${deps.escapeHtml(interaction.id)}">
    <div class="interaction-title">${interactionIcon(interaction)} ${deps.escapeHtml(interaction.title)}</div>
    <div class="interaction-body md-content">${deps.renderMarkdown(interaction.body)}</div>
    <div class="interaction-actions">${interactionActions(interaction)}</div>
  </div>`;
  }
  function autoInteractionAnswers(interaction) {
    const payload = deps.record(interaction?.payload) ? interaction.payload : null;
    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
    if (questions.length === 0) return null;
    return questions.map((item) => {
      const question = deps.record(item) ? item : null;
      const options = Array.isArray(question?.options) ? question.options : [];
      const selected = options.find(
        (option) => deps.record(option) && typeof option.label === "string" && option.label.trim()
      );
      if (selected && typeof selected.label === "string")
        return [selected.label.trim()];
      return null;
    });
  }
  function shouldAutoResolveInteraction(interaction) {
    if (!interaction || interaction.status !== "pending") return false;
    const exp = appStore.config?.experimental;
    if (interaction.type === "permission") {
      return stateFlag("autoPermission", exp?.auto_permission === true);
    }
    if (interaction.type === "question")
      return stateFlag("autoQuestion", exp?.auto_question === true) || stateFlag("unattended", exp?.unattended !== false);
    return false;
  }
  function bindInteractionActions(root) {
    root?.querySelectorAll?.(".interaction-alert [data-action]")?.forEach((btn) => {
      const el = btn;
      if (el.dataset.bound === "true") return;
      el.dataset.bound = "true";
      el.addEventListener("click", () => {
        const alert = el.closest(".interaction-alert");
        const id = alert?.dataset.id;
        if (!id) return;
        const action = el.dataset.action;
        if (action === "reject") void rejectInteraction(id);
        else void resolveInteraction(id, action ?? "");
      });
    });
  }
  function dismissInteractionModal() {
    const modal = deps.document?.getElementById("interaction-modal");
    if (modal) modal.remove();
    pendingInteraction = null;
    void refreshInteractionAttention();
  }
  function showInteractionModal(interaction) {
    let modal = deps.document?.getElementById("interaction-modal");
    if (modal && modal.dataset.interactionId === interaction.id) return;
    dismissInteractionModal();
    pendingInteraction = interaction;
    const html = `<div id="interaction-modal" class="interaction-modal-overlay" data-interaction-id="${deps.escapeHtml(interaction.id)}">
    <div class="interaction-modal">
      <div class="interaction-modal-title">${interactionIcon(interaction)} ${deps.escapeHtml(interaction.title)}</div>
      <div class="interaction-modal-body md-content">${deps.renderMarkdown(interaction.body)}</div>
      <div class="interaction-modal-actions">${interactionActions(interaction)}</div>
    </div>
  </div>`;
    deps.document?.body?.insertAdjacentHTML("beforeend", html);
    modal = deps.document?.getElementById("interaction-modal");
    modal?.querySelectorAll("[data-action]")?.forEach((btn) => {
      const el = btn;
      el.addEventListener("click", () => {
        const action = el.dataset.action;
        if (action === "reject") void rejectInteraction(interaction.id);
        else void resolveInteraction(interaction.id, action ?? "");
      });
    });
    void refreshInteractionAttention();
  }
  function attentionActive() {
    if (!pendingInteraction) return false;
    if (!deps.document) return true;
    return deps.document.visibilityState === "hidden" || !deps.document.hasFocus();
  }
  async function refreshInteractionAttention() {
    await deps.setTrayAttention?.(attentionActive());
  }
  function disableInteractionButtons(id) {
    const alert = deps.document?.querySelector(
      `.interaction-alert[data-id="${id}"]`
    );
    alert?.querySelectorAll("button")?.forEach((btn) => {
      const el = btn;
      el.disabled = true;
      el.style.opacity = "0.5";
    });
    const modal = deps.document?.querySelector(
      `#interaction-modal[data-interaction-id="${id}"]`
    );
    modal?.querySelectorAll("[data-action]")?.forEach((btn) => {
      const el = btn;
      el.disabled = true;
      el.style.opacity = "0.5";
    });
    const title = alert?.querySelector(".interaction-title");
    if (title) title.textContent += deps.t("interaction.processing_suffix");
  }
  function showInteractionError(id, msg) {
    const alert = deps.document?.querySelector(
      `.interaction-alert[data-id="${id}"]`
    );
    const title = alert?.querySelector(".interaction-title");
    if (title) title.textContent = deps.t("interaction.error", { message: msg });
    alert?.querySelectorAll("button")?.forEach((btn) => {
      const el = btn;
      el.disabled = false;
      el.style.opacity = "";
    });
  }
  async function resolveInteraction(id, action, input = {}) {
    if (busy) return;
    busy = true;
    autoResolveFailed.delete(id);
    disableInteractionButtons(id);
    try {
      if (action === "once" || action === "always") {
        await api(`interaction/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: action }),
          signal: AbortSignal.timeout(3e4)
        });
        return;
      }
      const answers = Array.isArray(input.answers) ? input.answers : null;
      const message = typeof input.message === "string" && input.message.trim() ? input.message.trim() : "";
      if (!answers && !message) {
        const answer = await deps.nativePrompt(
          deps.t("interaction.reply_prompt"),
          {
            title: deps.t("interaction.reply_title"),
            okLabel: deps.t("common.submit"),
            cancelLabel: deps.t("common.cancel"),
            inputLabel: deps.t("interaction.answer_label")
          }
        );
        if (answer == null) return;
        await api(`interaction/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: answer }),
          signal: AbortSignal.timeout(3e4)
        });
        return;
      }
      await api(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answers || void 0,
          message: message || void 0
        }),
        signal: AbortSignal.timeout(3e4)
      });
    } catch (error) {
      logger.error("ui", "Failed to resolve interaction", {
        error: String(error)
      });
      showInteractionError(id, error?.message || String(error));
      autoResolveFailed.set(id, Date.now());
    } finally {
      dismissInteractionModal();
      busy = false;
      await deps.loadBoard();
    }
  }
  async function rejectInteraction(id) {
    if (busy) return;
    busy = true;
    disableInteractionButtons(id);
    try {
      await api(`interaction/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(3e4)
      });
    } catch (error) {
      logger.error("ui", "Failed to reject interaction", {
        error: String(error)
      });
      showInteractionError(id, error?.message || String(error));
    } finally {
      dismissInteractionModal();
      busy = false;
      await deps.loadBoard();
    }
  }
  function isInteractionBusy() {
    return busy;
  }
  function renderInteractions(interactions) {
    const pending = Array.isArray(interactions) ? interactions.filter((item) => item.status === "pending") : [];
    const body = deps.dom?.goalsBody;
    body?.querySelectorAll(".interaction-alert")?.forEach((item) => item.remove());
    if (pending.length === 0) {
      dismissInteractionModal();
      return;
    }
    if (body) {
      body.insertAdjacentHTML(
        "beforeend",
        pending.map(interactionAlertHtml).join("")
      );
      bindInteractionActions(body);
    }
    if (!busy && shouldAutoResolveInteraction(pending[0])) {
      const cooldownMs = 1e4;
      const lastFail = autoResolveFailed.get(pending[0].id);
      if (lastFail && Date.now() - lastFail < cooldownMs) {
        pendingInteraction = pending[0];
        showInteractionModal(pending[0]);
        return;
      }
      dismissInteractionModal();
      if (pending[0].type === "permission") {
        void resolveInteraction(
          pending[0].id,
          autoPermissionReplyAction()
        );
        return;
      }
      const answers = autoInteractionAnswers(pending[0]);
      if (!answers || answers.some((item) => !Array.isArray(item) || item.length === 0)) {
        logger.warn(
          "ui",
          "Skipping automatic question reply due to missing structured options",
          { interactionID: pending[0].id }
        );
        pendingInteraction = pending[0];
        showInteractionModal(pending[0]);
        return;
      }
      void resolveInteraction(pending[0].id, "answer", {
        answers
      });
      return;
    }
    if (!busy) {
      pendingInteraction = pending[0];
      showInteractionModal(pending[0]);
      return;
    }
    pendingInteraction = null;
    void refreshInteractionAttention();
  }
  return {
    interactionAlertHtml,
    renderInteractions,
    showInteractionModal,
    dismissInteractionModal,
    resolveInteraction,
    rejectInteraction,
    isInteractionBusy,
    refreshInteractionAttention
  };
}

let paneDrag = null;
function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function paneHandleWidth(node) {
  if (!node) return 0;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  const width = node.getBoundingClientRect().width;
  if (width > 0) return width;
  return Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--ui-resizer-width"
    )
  ) || 0;
}
function defaultRailWidth() {
  const scale = currentUIScale();
  const panelWidth = document.getElementById("panelBody")?.clientWidth ?? window.visualViewport?.width ?? window.innerWidth ?? 900;
  return clampNumber(panelWidth * 0.24, 240 * scale, 420 * scale);
}
function currentUIScale() {
  if (typeof document === "undefined") return 1;
  return Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")
  ) || 1;
}
function resolvedPaneWidths(state) {
  const scale = currentUIScale();
  const panelWidth = document.getElementById("panelBody")?.clientWidth ?? window.visualViewport?.width ?? window.innerWidth ?? 900;
  const railMin = 180 * scale;
  const railMax = 520 * scale;
  const chatPreferred = 520 * scale;
  const chatMin = 420 * scale;
  const collapsedSidebar = 62 * scale;
  const leftHandle = state.sidebarCollapsed ? 0 : paneHandleWidth(document.getElementById("leftPaneResizer"));
  const rightHandle = paneHandleWidth(
    document.getElementById("rightPaneResizer")
  );
  let sidebar = clampNumber(
    state.sidebarWidth ?? defaultRailWidth(),
    railMin,
    railMax
  );
  let sections = clampNumber(
    state.sectionsWidth ?? defaultRailWidth(),
    railMin,
    railMax
  );
  const total = panelWidth - leftHandle - rightHandle;
  let actualSidebar = state.sidebarCollapsed ? collapsedSidebar : sidebar;
  const sidebarFloor = state.sidebarCollapsed ? collapsedSidebar : railMin;
  if (actualSidebar + sections + chatPreferred > total) {
    let overflow = actualSidebar + sections + chatPreferred - total;
    const sidebarCap = Math.max(0, actualSidebar - sidebarFloor);
    const sectionsCap = Math.max(0, sections - railMin);
    const totalCap = sidebarCap + sectionsCap;
    if (totalCap > 0) {
      const sidebarShrink = Math.min(
        sidebarCap,
        overflow * (sidebarCap / totalCap)
      );
      actualSidebar -= sidebarShrink;
      overflow -= sidebarShrink;
      const sectionsShrink = Math.min(sectionsCap, overflow);
      sections -= sectionsShrink;
      overflow -= sectionsShrink;
      if (overflow > 0 && !state.sidebarCollapsed) {
        const extraSidebar = Math.min(
          Math.max(0, actualSidebar - railMin),
          overflow
        );
        actualSidebar -= extraSidebar;
      }
    }
  }
  if (actualSidebar + sections + chatMin > total) {
    const overflow = actualSidebar + sections + chatMin - total;
    const sectionsShrink = Math.min(
      Math.max(0, sections - railMin),
      overflow
    );
    sections -= sectionsShrink;
    const remaining = overflow - sectionsShrink;
    if (remaining > 0 && !state.sidebarCollapsed) {
      actualSidebar -= Math.min(
        Math.max(0, actualSidebar - railMin),
        remaining
      );
    }
  }
  sidebar = clampNumber(actualSidebar, sidebarFloor, railMax);
  sections = clampNumber(sections, railMin, railMax);
  return { sidebar: Math.round(sidebar), sections: Math.round(sections) };
}
function renderPaneLayout(state) {
  if (typeof document === "undefined") return;
  const widths = resolvedPaneWidths(state);
  document.documentElement.style.setProperty(
    "--ui-sidebar-width",
    `${widths.sidebar}px`
  );
  document.documentElement.style.setProperty(
    "--ui-sections-width",
    `${widths.sections}px`
  );
}
function resizePane(side, clientX, callbacks) {
  const scale = currentUIScale();
  const railMin = 180 * scale;
  const railMax = 520 * scale;
  const chatMin = 420 * scale;
  const state = callbacks.getState();
  if (side === "left") {
    const panelBody = document.getElementById("panelBody");
    const rect2 = panelBody?.getBoundingClientRect();
    if (!rect2) return;
    const { sections } = resolvedPaneWidths(state);
    const leftHandle = paneHandleWidth(
      document.getElementById("leftPaneResizer")
    );
    const rightHandle2 = paneHandleWidth(
      document.getElementById("rightPaneResizer")
    );
    const max2 = Math.max(
      railMin,
      rect2.width - sections - leftHandle - rightHandle2 - chatMin
    );
    const newSidebarWidth = Math.round(
      clampNumber(clientX - rect2.left, railMin, Math.min(railMax, max2))
    );
    renderPaneLayout({ ...state, sidebarWidth: newSidebarWidth });
    return;
  }
  const workspaceMain = document.getElementById("workspaceMain");
  const rect = workspaceMain?.getBoundingClientRect();
  if (!rect) return;
  const rightHandle = paneHandleWidth(
    document.getElementById("rightPaneResizer")
  );
  const max = Math.max(railMin, rect.width - rightHandle - chatMin);
  const newSectionsWidth = Math.round(
    clampNumber(rect.right - clientX, railMin, Math.min(railMax, max))
  );
  renderPaneLayout({ ...state, sectionsWidth: newSectionsWidth });
}
function onPaneResizeMove(event, callbacks) {
  if (!paneDrag) return;
  resizePane(paneDrag.side, event.clientX, callbacks);
}
async function stopPaneResize(callbacks) {
  if (!paneDrag) return;
  const handleId = paneDrag.side === "left" ? "leftPaneResizer" : "rightPaneResizer";
  const handle = document.getElementById(handleId);
  if (handle) delete handle.dataset.active;
  paneDrag.side;
  paneDrag = null;
  delete document.body.dataset.resizing;
  const sidebarPx = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--ui-sidebar-width"
    )
  );
  const sectionsPx = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--ui-sections-width"
    )
  );
  await callbacks.onWidthsChanged(
    Number.isFinite(sidebarPx) ? Math.round(sidebarPx) : null,
    Number.isFinite(sectionsPx) ? Math.round(sectionsPx) : null
  );
}
function startPaneResize(side, event, callbacks) {
  if (event.button != null && event.button !== 0) return;
  const state = callbacks.getState();
  if (side === "left" && (state.sidebarCollapsed || paneHandleWidth(document.getElementById("leftPaneResizer")) === 0)) {
    return;
  }
  if (side === "right" && paneHandleWidth(document.getElementById("rightPaneResizer")) === 0) {
    return;
  }
  paneDrag = { side };
  const handleId = side === "left" ? "leftPaneResizer" : "rightPaneResizer";
  const handle = document.getElementById(handleId);
  if (handle) handle.dataset.active = "true";
  document.body.dataset.resizing = "true";
  function onMove(ev) {
    onPaneResizeMove(ev, callbacks);
  }
  async function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    await stopPaneResize(callbacks);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  resizePane(side, event.clientX, callbacks);
  event.preventDefault();
}
function initPaneResizers(callbacks) {
  const leftHandle = document.getElementById("leftPaneResizer");
  const rightHandle = document.getElementById("rightPaneResizer");
  function onLeftDown(ev) {
    startPaneResize("left", ev, callbacks);
  }
  function onRightDown(ev) {
    startPaneResize("right", ev, callbacks);
  }
  leftHandle?.addEventListener("pointerdown", onLeftDown);
  rightHandle?.addEventListener("pointerdown", onRightDown);
  renderPaneLayout(callbacks.getState());
  return () => {
    leftHandle?.removeEventListener("pointerdown", onLeftDown);
    rightHandle?.removeEventListener("pointerdown", onRightDown);
  };
}
async function cancelPaneResize(callbacks) {
  if (!paneDrag) return;
  await stopPaneResize(callbacks);
}

async function tauriInvoke(command, args) {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    return globalInvoke(command, args);
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}
function checkConfig(task) {
  const checks = task?.metadata?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {};
  return structuredClone(checks);
}
function hasExplicitChecks(config) {
  return Object.keys(config).length > 0;
}
function checkCanToggle(key) {
  return ["artifact", "ui_review", "code_quality", "code_review", "dead_code_review", "spec_check"].includes(key);
}
function checkSelectionConfig(key, current) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? structuredClone(current) : void 0;
  if (key === "artifact") return base || {};
  if (key === "ui_review") return { ...base || {}, target: "web" };
  if (["code_quality", "code_review", "dead_code_review", "spec_check"].includes(key)) {
    return { ...base || {}, enabled: true };
  }
  if (["startup", "visual", "puppeteer"].includes(key)) return base;
  return { ...base || {}, enabled: true };
}
function buildCheckConfigFromSpecs(task, selection) {
  const current = checkConfig(task);
  const next = structuredClone(current);
  const named = next.named && typeof next.named === "object" && !Array.isArray(next.named) ? structuredClone(next.named) : {};
  for (const spec of appStore.criteriaSpecs) {
    if (spec.readOnly) continue;
    const enabled = selection[spec.key];
    if (enabled === void 0) continue;
    if (spec.kind === "named") {
      const currentNamed = named[spec.name];
      if (!currentNamed || typeof currentNamed !== "object" || Array.isArray(currentNamed)) continue;
      named[spec.name] = { ...currentNamed, enabled };
      continue;
    }
    if (spec.kind === "command") {
      if (enabled) {
        if (next[spec.name] === false) delete next[spec.name];
        continue;
      }
      next[spec.name] = false;
      continue;
    }
    if (enabled) {
      const currentValue = next[spec.name];
      const value = checkSelectionConfig(spec.name, currentValue);
      if (value) next[spec.name] = value;
      continue;
    }
    delete next[spec.name];
  }
  if (Object.keys(named).length > 0) next.named = named;
  else delete next.named;
  return next;
}
async function patchConfig$2(diff) {
  if (!appStore.connected) return null;
  try {
    const saved = await apiJson("config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diff)
    });
    setAppStore("config", saved);
    return saved;
  } catch (e) {
    console.error("[config] patchConfig failed", e);
    return null;
  }
}
async function updateConfig(mutator) {
  const current = await apiJson("config");
  const next = structuredClone(current || {});
  mutator(next);
  return apiJson("config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next)
  });
}
async function scaffoldProjectConfig(dir) {
  if (!dir) return;
  const base = dir.replace(/[\\/]+$/, "");
  const configFile = base + "/.opencorvus/opencorvus.jsonc";
  const username = settingsStore.username || "";
  const unattended = appStore.config?.experimental?.unattended !== false;
  const config = {
    $schema: "https://opencorvus.ai/config.json",
    experimental: {
      unattended
    },
    lsp: {
      biome: { disabled: true },
      eslint: { disabled: true }
    },
    assistant: {},
    compaction: {
      auto: true,
      prune: true
    },
    agent: {},
    plugin: [],
    command: {},
    username
  };
  try {
    await tauriInvoke("overlay_write_file", { path: configFile, content: JSON.stringify(config, null, 2) });
  } catch (e) {
    console.warn("[scaffold] Failed to scaffold project config", e);
  }
}
async function reloadProjectScope(options = {}) {
  const { loadConfigInfo } = await __vitePreload(async () => { const { loadConfigInfo } = await Promise.resolve().then(() => init);return { loadConfigInfo }},true              ?void 0:void 0);
  const { loadExtensions } = await __vitePreload(async () => { const { loadExtensions } = await Promise.resolve().then(() => extensions);return { loadExtensions }},true              ?void 0:void 0);
  const { loadMeta } = await __vitePreload(async () => { const { loadMeta } = await Promise.resolve().then(() => meta);return { loadMeta }},true              ?void 0:void 0);
  const { loadTasks } = await __vitePreload(async () => { const { loadTasks } = await Promise.resolve().then(() => board);return { loadTasks }},true              ?void 0:void 0);
  const { loadExecutors } = await __vitePreload(async () => { const { loadExecutors } = await Promise.resolve().then(() => executor);return { loadExecutors }},true              ?void 0:void 0);
  await Promise.all([
    loadConfigInfo().catch((e) => console.error("[reloadProjectScope] loadConfigInfo", e)),
    loadExtensions().catch((e) => console.error("[reloadProjectScope] loadExtensions", e)),
    loadMeta().catch((e) => console.error("[reloadProjectScope] loadMeta", e)),
    loadTasks().catch((e) => console.error("[reloadProjectScope] loadTasks", e)),
    loadExecutors().catch((e) => console.error("[reloadProjectScope] loadExecutors", e))
  ]);
  if (options.restoreWorkspace) {
    const { restoreWorkspaceDirectory } = await __vitePreload(async () => { const { restoreWorkspaceDirectory } = await Promise.resolve().then(() => workspace);return { restoreWorkspaceDirectory }},true              ?void 0:void 0);
    try {
      restoreWorkspaceDirectory();
    } catch (e) {
      console.error("[reloadProjectScope] restoreWorkspaceDirectory", e);
    }
  }
}
function applyPromptEntries(items) {
  const entries = Array.isArray(items) ? items : [];
  setAppStore("promptEntries", entries);
}
async function loadPromptCatalog() {
  try {
    const items = await apiJson("config/prompt");
    applyPromptEntries(items);
  } catch (e) {
    AppLog.debug("prompt", "loadPromptCatalog failed, resetting to empty", { error: String(e) });
    applyPromptEntries([]);
  }
}
async function savePromptEntry(entry, value) {
  if (!entry) return;
  try {
    await updateConfig((current) => {
      if (entry.scope === "system") {
        current.prompt = current.prompt || {};
        if (value.trim()) current.prompt[entry.key] = value;
        else delete current.prompt[entry.key];
        if (Object.keys(current.prompt).length === 0) delete current.prompt;
        return;
      }
      current.agent = current.agent || {};
      const item = current.agent?.[entry.key] && typeof current.agent[entry.key] === "object" ? { ...current.agent[entry.key] } : {};
      if (value.trim()) item.prompt = value;
      else delete item.prompt;
      if (Object.keys(item).length === 0) delete current.agent[entry.key];
      else current.agent[entry.key] = item;
      if (Object.keys(current.agent).length === 0) delete current.agent;
    });
    await loadPromptCatalog();
  } catch (e) {
    AppLog.error("ui", "Failed to save prompt override", { error: String(e) });
    throw e;
  }
}
async function resetPromptEntry(entry) {
  if (!entry) return;
  if (entry.configured_prompt === null) return;
  `${entry.scope}:${entry.key}`;
  try {
    await updateConfig((current) => {
      if (entry.scope === "system") {
        if (current.prompt && typeof current.prompt === "object") {
          delete current.prompt[entry.key];
          if (Object.keys(current.prompt).length === 0) delete current.prompt;
        }
        return;
      }
      if (current.agent && typeof current.agent === "object" && current.agent[entry.key]) {
        const item = current.agent[entry.key] && typeof current.agent[entry.key] === "object" ? { ...current.agent[entry.key] } : {};
        delete item.prompt;
        if (Object.keys(item).length === 0) delete current.agent[entry.key];
        else current.agent[entry.key] = item;
        if (Object.keys(current.agent).length === 0) delete current.agent;
      }
    });
    await loadPromptCatalog();
  } catch (e) {
    AppLog.error("ui", "Failed to reset prompt override", { error: String(e) });
    throw e;
  }
}

const config = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  applyPromptEntries,
  buildCheckConfigFromSpecs,
  checkCanToggle,
  checkConfig,
  checkSelectionConfig,
  hasExplicitChecks,
  loadPromptCatalog,
  patchConfig: patchConfig$2,
  reloadProjectScope,
  resetPromptEntry,
  savePromptEntry,
  scaffoldProjectConfig,
  updateConfig
}, Symbol.toStringTag, { value: 'Module' }));

function taskBudget(task = boardStore.board?.task) {
  const budget = task?.budget;
  if (!budget || typeof budget !== "object") return void 0;
  return {
    maxRuns: Number.isFinite(budget.maxRuns) ? budget.maxRuns : void 0,
    maxExecutorGroups: Number.isFinite(budget.maxExecutorGroups) ? budget.maxExecutorGroups : void 0
  };
}
function setBudgetInputs(budget) {
  const setValue = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = value;
  };
  setValue("budgetMaxRuns", budget?.maxRuns === void 0 ? "" : String(budget.maxRuns));
  setValue("budgetMaxExecutorGroups", budget?.maxExecutorGroups === void 0 ? "" : String(budget.maxExecutorGroups));
}
function configDefaults() {
  const orch = appStore.config?.assistant;
  if (!orch || typeof orch !== "object") return {};
  return {
    maxRuns: Number.isFinite(orch.max_runs) ? orch.max_runs : void 0,
    maxExecutorGroups: Number.isFinite(orch.max_executor_groups) ? orch.max_executor_groups : void 0
  };
}
function setPlaceholders() {
  const defaults = configDefaults();
  const setPlaceholder = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.placeholder = value || t("budget.placeholder");
  };
  setPlaceholder("budgetMaxRuns", defaults.maxRuns != null ? String(defaults.maxRuns) : "");
  setPlaceholder("budgetMaxExecutorGroups", defaults.maxExecutorGroups != null ? String(defaults.maxExecutorGroups) : "");
}
function renderBudgetState(task = boardStore.board?.task) {
  const budget = taskBudget(task);
  const taskID = task?.id || boardStore.selectedTaskID;
  const inputsEnabled = !taskID && !appStore.budgetSaving;
  const changed = taskID ? !sameBudget(draftBudget(), budget) : appStore.budgetDirty;
  const enabled = !appStore.budgetSaving;
  const saveButton = document.getElementById("btnBudgetSave");
  const resetButton = document.getElementById("btnBudgetReset");
  const reloadButton = document.getElementById("btnBudgetReload");
  const hint = document.getElementById("budgetHint");
  if (saveButton) saveButton.disabled = !inputsEnabled || !changed;
  if (resetButton) resetButton.disabled = !inputsEnabled || !changed && !appStore.budgetDirty;
  if (reloadButton) reloadButton.disabled = !enabled || appStore.budgetSaving;
  if (hint) {
    hint.textContent = taskID ? t("budget.hint_readonly") : t("budget.hint");
  }
  setPlaceholders();
  for (const input of [
    document.getElementById("budgetMaxRuns"),
    document.getElementById("budgetMaxExecutorGroups")
  ]) {
    if (input instanceof HTMLInputElement) input.disabled = !inputsEnabled;
  }
}
function renderBudget(task) {
  const taskID = task?.id || boardStore.selectedTaskID;
  if (!appStore.budgetDirty) {
    setBudgetInputs(taskID ? taskBudget(task) : configDefaults());
  }
  renderBudgetState(task);
}
function budgetSaveError(error) {
  const detail = error instanceof Error ? error.message : String(error || "").trim();
  return detail ? `${t("budget.save_failed")}: ${detail}` : t("budget.save_failed");
}
function installBudgetBindings() {
  const body = document.getElementById("budgetConfigBody");
  if (!(body instanceof HTMLElement) || body.dataset.boundBudget === "true") return;
  body.dataset.boundBudget = "true";
  body.addEventListener("input", () => {
    setAppStore("budgetDirty", true);
    renderBudgetState(boardStore.board?.task);
  });
  document.getElementById("btnBudgetReset")?.addEventListener("click", () => {
    setAppStore("budgetDirty", false);
    const taskID = boardStore.selectedTaskID;
    setBudgetInputs(taskID ? taskBudget() : configDefaults());
    renderBudgetState(boardStore.board?.task);
  });
  document.getElementById("btnBudgetReload")?.addEventListener("click", async () => {
    if (!boardStore.selectedTaskID || appStore.budgetSaving) return;
    setAppStore("budgetDirty", false);
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      await loadBoard({ sync: true });
    } finally {
      setAppStore("budgetSaving", false);
      renderBudget(boardStore.board?.task);
    }
  });
  document.getElementById("btnBudgetSave")?.addEventListener("click", async () => {
    if (appStore.budgetSaving) return;
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      const budget = draftBudget();
      if (boardStore.selectedTaskID) {
        await apiJson(`task/${encodeURIComponent(boardStore.selectedTaskID)}/budget`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ budget: budget || null })
        });
        await loadBoard({ sync: true });
      } else {
        await patchConfig$2({
          assistant: {
            max_runs: budget?.maxRuns ?? null,
            max_executor_groups: budget?.maxExecutorGroups ?? null
          }
        });
      }
      setAppStore("budgetDirty", false);
    } catch (error) {
      console.error("Failed to update budget", error);
      const nativeMessage = window.nativeMessage;
      if (typeof nativeMessage === "function") {
        await nativeMessage(budgetSaveError(error), {
          title: t("section.budget"),
          kind: "error"
        });
      }
    } finally {
      setAppStore("budgetSaving", false);
      renderBudgetState(boardStore.board?.task);
    }
  });
}

var _tmpl$$8 = /* @__PURE__ */ template(`<div class=config-status-box>`), _tmpl$2$7 = /* @__PURE__ */ template(`<div class=prompt-grid>`), _tmpl$3$7 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$4$6 = /* @__PURE__ */ template(`<small>`), _tmpl$5$6 = /* @__PURE__ */ template(`<details class=prompt-diff-details><summary class=prompt-diff-summary></summary><div class=prompt-preview-card style=margin-top:0;border-top:none;opacity:0.7><div class=prompt-preview-head></div><div class="md-content prompt-preview-body">`), _tmpl$6$6 = /* @__PURE__ */ template(`<div class=prompt-card><div class=prompt-card-head><div class=prompt-card-copy><strong></strong><span></span></div><span class=extension-status></span></div><label class=field><span class=field-label></span><textarea class="field-input prompt-textarea"rows=8></textarea></label><div class=prompt-toolbar><span class=config-status-box></span><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-primary mini"></button></div></div><details class=prompt-diff-details><summary class=prompt-diff-summary></summary><div class=prompt-preview-card style="border-top:none;border-radius:0 0 var(--radius) var(--radius)"><div class="md-content prompt-preview-body">`);
function promptEntryID(entry) {
  return `${entry.scope}:${entry.key}`;
}
function promptGroupLabel(group) {
  if (group === "core") return t("prompt.group.core");
  if (group === "generator") return t("prompt.group.generator");
  if (group === "assistant") return t("prompt.group.assistant");
  if (group === "subagent") return t("prompt.group.subagent");
  if (group === "hidden_agent") return t("prompt.group.hidden_agent");
  if (group === "custom_agent") return t("prompt.group.custom_agent");
  return t("prompt.group.primary_agent");
}
function promptDescription(entry) {
  if (entry.key === "core_header") return t("prompt.desc.core_header");
  if (entry.key === "agent_generate") return t("prompt.desc.agent_generate");
  if (entry.key === "planner_system") return t("prompt.desc.planner_system");
  if (entry.key === "spec_system") return t("prompt.desc.spec_system");
  if (entry.key === "evaluator_system") return t("prompt.desc.evaluator_system");
  if (entry.key === "delivery_system") return t("prompt.desc.delivery_system");
  return entry.description || "";
}
function promptStatus(entry) {
  if (entry.configured_prompt !== null) {
    return {
      label: t("prompt.status.custom"),
      tone: "active"
    };
  }
  if (entry.scope === "system") {
    return {
      label: t("prompt.status.default"),
      tone: "ready"
    };
  }
  if (entry.inherits_core) {
    return {
      label: t("prompt.status.inherits_core"),
      tone: "warn"
    };
  }
  if (entry.prompt) {
    return {
      label: t("prompt.status.default"),
      tone: "ready"
    };
  }
  return {
    label: t("prompt.status.empty"),
    tone: ""
  };
}
function promptHelper(entry) {
  if (entry.scope === "system") {
    return entry.configured_prompt !== null ? t("prompt.help.custom_system") : t("prompt.help.default_system");
  }
  if (entry.inherits_core) return t("prompt.help.inherits_core");
  if (entry.configured_prompt !== null) return t("prompt.help.custom_agent");
  if (entry.prompt) return t("prompt.help.default_agent");
  return t("prompt.help.optional_agent");
}
function promptPreviewHtml(value) {
  if (!value.trim()) {
    return `<p class="empty-hint">${t("prompt.preview_empty")}</p>`;
  }
  return renderMarkdown(value);
}
function PromptCatalog() {
  const [drafts, setDrafts] = createStore({});
  const [notice, setNotice] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const entries = createMemo(() => {
    const raw = appStore.promptEntries;
    return Array.isArray(raw) ? raw : [];
  });
  function draftValue(entry) {
    const id = promptEntryID(entry);
    const val = drafts[id];
    return val !== void 0 ? val : entry.prompt || "";
  }
  function isDirty(entry) {
    return draftValue(entry) !== (entry.prompt || "");
  }
  function handleDraftChange(entryID, value) {
    setDrafts(entryID, value);
  }
  async function handleSave(entry) {
    const value = draftValue(entry);
    setSaving(true);
    try {
      await savePromptEntry(entry, value);
      const id = promptEntryID(entry);
      setDrafts(id, void 0);
      showNotice(t("common.saved"), "active");
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function handleReset(entry) {
    const entryID = promptEntryID(entry);
    if (entry.configured_prompt === null) {
      setDrafts(entryID, entry.prompt || "");
      return;
    }
    setSaving(true);
    try {
      await resetPromptEntry(entry);
      setDrafts(entryID, void 0);
      showNotice(t("prompt.reset_done"), "active");
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }
  let noticeTimer;
  function showNotice(msg, tone = "") {
    if (noticeTimer) clearTimeout(noticeTimer);
    setNotice(msg);
    setNoticeTone(tone);
    if (msg) {
      noticeTimer = setTimeout(() => setNotice(""), 2600);
    }
  }
  createMemo(() => entries().filter((e) => e.configured_prompt !== null).length);
  return [createComponent(Show, {
    get when() {
      return notice();
    },
    get children() {
      var _el$ = _tmpl$$8();
      insert(_el$, notice);
      createRenderEffect(() => setAttribute(_el$, "data-status", noticeTone()));
      return _el$;
    }
  }), createComponent(Show, {
    get when() {
      return entries().length > 0;
    },
    get fallback() {
      return (() => {
        var _el$3 = _tmpl$3$7();
        insert(_el$3, () => t("prompt.none"));
        return _el$3;
      })();
    },
    get children() {
      var _el$2 = _tmpl$2$7();
      insert(_el$2, createComponent(For, {
        get each() {
          return entries();
        },
        children: (entry) => {
          const entryID = promptEntryID(entry);
          const status = createMemo(() => promptStatus(entry));
          const description = promptDescription(entry);
          const dirty = createMemo(() => isDirty(entry));
          const currentDraft = createMemo(() => draftValue(entry));
          return (() => {
            var _el$4 = _tmpl$6$6(), _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$0 = _el$6.nextSibling, _el$1 = _el$5.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$1.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$22 = _el$12.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$24.firstChild;
            setAttribute(_el$4, "data-prompt-entry", entryID);
            insert(_el$7, () => entry.label || entry.key);
            insert(_el$8, () => promptGroupLabel(entry.group), null);
            insert(_el$8, (() => {
              var _c$ = memo(() => !!entry.mode);
              return () => _c$() ? ` · ${entry.mode}` : "";
            })(), null);
            insert(_el$8, () => entry.inherits_core ? " · ← core_header" : "", null);
            insert(_el$6, createComponent(Show, {
              when: description,
              get children() {
                var _el$9 = _tmpl$4$6();
                insert(_el$9, description);
                return _el$9;
              }
            }), null);
            insert(_el$0, () => status().label);
            insert(_el$10, () => t("prompt.editor_label"));
            _el$11.$$input = (e) => handleDraftChange(entryID, e.currentTarget.value);
            insert(_el$13, () => promptHelper(entry));
            _el$15.$$click = () => handleReset(entry);
            insert(_el$15, () => t("prompt.reset"));
            _el$16.$$click = () => handleSave(entry);
            insert(_el$16, () => t("common.save"));
            insert(_el$4, createComponent(Show, {
              get when() {
                return memo(() => entry.configured_prompt !== null)() && entry.default_prompt;
              },
              get children() {
                var _el$17 = _tmpl$5$6(), _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling;
                insert(_el$18, () => t("prompt.show_default"));
                insert(_el$20, () => t("prompt.default_label"));
                createRenderEffect(() => _el$21.innerHTML = promptPreviewHtml(entry.default_prompt));
                return _el$17;
              }
            }), _el$22);
            insert(_el$23, () => t("prompt.preview"));
            createRenderEffect((_p$) => {
              var _v$ = status().tone, _v$2 = saving(), _v$3 = status().tone, _v$4 = saving() || entry.configured_prompt === null && !dirty(), _v$5 = saving() || !dirty(), _v$6 = promptPreviewHtml(currentDraft());
              _v$ !== _p$.e && setAttribute(_el$0, "data-state", _p$.e = _v$);
              _v$2 !== _p$.t && (_el$11.disabled = _p$.t = _v$2);
              _v$3 !== _p$.a && setAttribute(_el$13, "data-status", _p$.a = _v$3);
              _v$4 !== _p$.o && (_el$15.disabled = _p$.o = _v$4);
              _v$5 !== _p$.i && (_el$16.disabled = _p$.i = _v$5);
              _v$6 !== _p$.n && (_el$25.innerHTML = _p$.n = _v$6);
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0,
              o: void 0,
              i: void 0,
              n: void 0
            });
            createRenderEffect(() => _el$11.value = currentDraft());
            return _el$4;
          })();
        }
      }));
      return _el$2;
    }
  })];
}
delegateEvents(["input", "click"]);

function legacyFn(name, ...args) {
  const fn = window[name];
  if (typeof fn === "function") return fn(...args);
  return void 0;
}
async function nativeConfirm(message, options) {
  const result = await legacyFn("showAppDialog", {
    title: options?.title,
    message,
    kind: options?.kind || "warning",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true
  });
  return !!result?.confirmed;
}
async function nativePrompt(message, options) {
  const result = await legacyFn("showAppDialog", {
    title: options?.title,
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true,
    input: true,
    inputLabel: options?.inputLabel,
    inputPlaceholder: options?.inputPlaceholder || "",
    inputValue: options?.inputValue || ""
  });
  return result?.confirmed ? result.value ?? null : null;
}
async function nativeSelect(message, options) {
  const list = Array.isArray(options?.options) ? options.options : [];
  if (!list.length) return null;
  const result = await legacyFn("showAppDialog", {
    title: options?.title,
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true,
    select: true,
    selectLabel: options?.selectLabel,
    selectOptions: list,
    selectValue: options?.selectValue || list[0]?.value || ""
  });
  return result?.confirmed ? result.value ?? null : null;
}
async function nativeOpen(target) {
  if (!target) return false;
  const isUrl = /^https?:\/\//i.test(target);
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    try {
      const opened = isUrl ? await invoke("overlay_open_url", { url: target }) : await invoke("overlay_open_path", { path: target });
      if (opened) return true;
    } catch {
    }
  }
  if (isUrl) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  try {
    const result = await apiJson("path/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target })
    });
    return result?.opened === true;
  } catch (openErr) {
    AppLog.debug("ui", "path/open fallback failed", {
      target,
      error: String(openErr)
    });
    return false;
  }
}

var _tmpl$$7 = /* @__PURE__ */ template(`<div class=config-status-box>`), _tmpl$2$6 = /* @__PURE__ */ template(`<div class=extension-head><label class=field><span class=field-label></span><input class=field-input type=url placeholder=https://opencorvus.example.com></label><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini">`), _tmpl$3$6 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$4$5 = /* @__PURE__ */ template(`<div class=extension-row><div class=extension-row-main><strong></strong><span></span><small class=channel-doc-credit></small></div><div class=channel-row-actions><span class=extension-status></span><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-primary mini">`), _tmpl$5$5 = /* @__PURE__ */ template(`<dialog class=dialog><div class=dialog-form><div class=dialog-head><h2 class=dialog-title></h2></div><div class=channel-doc-card><div class=channel-doc-copy><span class=channel-doc-title></span><small class=channel-doc-credit></small></div><button type=button class="btn btn-ghost"></button></div><div class=dialog-actions><button type=button class="btn btn-ghost"></button><button type=button class="btn btn-primary">`), _tmpl$6$5 = /* @__PURE__ */ template(`<label class="field field-inline"><span class=field-label></span><input type=checkbox>`), _tmpl$7$5 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input>`);
const OPENCLAW_DOCS = Object.freeze({
  overview: "https://docs.openclaw.ai/channels",
  credit: "OpenClaw Docs",
  slack: "https://docs.openclaw.ai/channels/slack",
  telegram: "https://docs.openclaw.ai/channels/telegram",
  discord: "https://docs.openclaw.ai/channels/discord",
  feishu: "https://docs.openclaw.ai/channels/feishu",
  whatsapp: "https://docs.openclaw.ai/channels/whatsapp",
  googlechat: "https://docs.openclaw.ai/channels/googlechat",
  msteams: "https://docs.openclaw.ai/channels/msteams",
  line: "https://docs.openclaw.ai/channels/line",
  matrix: "https://docs.openclaw.ai/channels/matrix",
  mattermost: "https://docs.openclaw.ai/channels/mattermost",
  signal: "https://docs.openclaw.ai/channels/signal",
  wecom: "https://docs.openclaw.ai/channels",
  dingtalk: "https://docs.openclaw.ai/channels"
});
function channelTutorialUrl(channelID) {
  return OPENCLAW_DOCS[channelID] || OPENCLAW_DOCS.overview;
}
function channelStatusLabel(status) {
  const map = {
    configured: t("channel.status.configured"),
    partial: t("channel.status.partial"),
    missing: t("channel.status.missing"),
    disabled: t("channel.status.disabled")
  };
  return map[status] || status;
}
function ChannelsPanel() {
  const [editingID, setEditingID] = createSignal(null);
  const [fieldValues, setFieldValues] = createSignal({});
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal("");
  const channels = createMemo(() => {
    const raw = appStore.channels;
    return Array.isArray(raw) ? raw : [];
  });
  const publicUrl = createMemo(() => {
    return appStore.config?.server?.publicUrl || "";
  });
  const [localPublicUrl, setLocalPublicUrl] = createSignal("");
  createEffect(() => {
    const storeUrl = publicUrl();
    if (!saving()) setLocalPublicUrl(storeUrl);
  });
  const editingEntry = createMemo(() => channels().find((c) => c.id === editingID()) ?? null);
  function configValueForChannel(channelID, key) {
    return appStore.config?.channel?.[channelID]?.[key];
  }
  function openEdit(channelID) {
    const entry = channels().find((c) => c.id === channelID);
    if (!entry) return;
    const initial = {};
    for (const field of entry.fields) {
      const existing = configValueForChannel(entry.id, field.key);
      if (field.type === "boolean") {
        initial[field.key] = existing !== false;
      } else {
        initial[field.key] = existing != null ? String(existing) : "";
      }
    }
    setFieldValues(initial);
    setEditingID(channelID);
  }
  function closeEdit() {
    setEditingID(null);
    setFieldValues({});
  }
  async function handleSaveChannel() {
    const entry = editingEntry();
    if (!entry) return;
    setSaving(true);
    try {
      const config = await apiJson("config");
      config.channel = config.channel || {};
      const next = {};
      for (const field of entry.fields) {
        if (field.type === "boolean") {
          next[field.key] = fieldValues()[field.key] !== false;
        } else {
          const value = String(fieldValues()[field.key] ?? "").trim();
          if (value) next[field.key] = value;
        }
      }
      config.channel[entry.id] = next;
      await apiJson("config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(config)
      });
      showNotice(t("common.saved"), "active");
      closeEdit();
      await loadConfigInfo();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function handleSavePublicUrl() {
    setSaving(true);
    try {
      await updateConfig((current) => {
        current.server = current.server || {};
        current.server.publicUrl = localPublicUrl().trim() || void 0;
        if (current.server.publicUrl === void 0) delete current.server.publicUrl;
        if (Object.keys(current.server).length === 0) delete current.server;
      });
      showNotice(t("common.saved"), "active");
      await loadConfigInfo();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }
  let noticeTimer;
  function showNotice(msg, tone = "") {
    if (noticeTimer) clearTimeout(noticeTimer);
    setNotice(msg);
    setNoticeTone(tone);
    if (msg) {
      noticeTimer = setTimeout(() => setNotice(""), 2600);
    }
  }
  function handleFieldChange(key, value) {
    setFieldValues((prev) => ({
      ...prev,
      [key]: value
    }));
  }
  return [createComponent(Show, {
    get when() {
      return notice();
    },
    get children() {
      var _el$ = _tmpl$$7();
      insert(_el$, notice);
      createRenderEffect(() => setAttribute(_el$, "data-status", noticeTone()));
      return _el$;
    }
  }), (() => {
    var _el$2 = _tmpl$2$6(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling, _el$7 = _el$6.firstChild;
    insert(_el$4, () => t("channel.public_url"));
    _el$5.$$input = (e) => setLocalPublicUrl(e.currentTarget.value);
    _el$7.$$click = handleSavePublicUrl;
    insert(_el$7, () => t("common.save"));
    createRenderEffect(() => _el$7.disabled = saving());
    createRenderEffect(() => _el$5.value = localPublicUrl());
    return _el$2;
  })(), (() => {
    var _el$8 = _tmpl$3$6();
    insert(_el$8, () => t("channel.public_url_hint"));
    return _el$8;
  })(), createComponent(Show, {
    get when() {
      return channels().length > 0;
    },
    get fallback() {
      return (() => {
        var _el$9 = _tmpl$3$6();
        insert(_el$9, () => t("channel.none"));
        return _el$9;
      })();
    },
    get children() {
      return createComponent(For, {
        get each() {
          return channels();
        },
        children: (item) => (() => {
          var _el$0 = _tmpl$4$5(), _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$11.nextSibling, _el$13 = _el$1.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.nextSibling;
          insert(_el$10, () => item.name);
          insert(_el$11, () => item.summary);
          insert(_el$12, () => t("channel.tutorial_credit", {
            source: OPENCLAW_DOCS.credit
          }));
          insert(_el$14, () => channelStatusLabel(item.status));
          _el$15.$$click = () => nativeOpen(channelTutorialUrl(item.id));
          insert(_el$15, () => t("channel.tutorial"));
          _el$16.$$click = () => openEdit(item.id);
          insert(_el$16, () => t("common.edit"));
          createRenderEffect((_p$) => {
            var _v$ = item.status, _v$2 = t("channel.tutorial_hint"), _v$3 = t("channel.tutorial_hint"), _v$4 = t("channel.edit_title"), _v$5 = t("channel.edit_title");
            _v$ !== _p$.e && setAttribute(_el$14, "data-state", _p$.e = _v$);
            _v$2 !== _p$.t && setAttribute(_el$15, "title", _p$.t = _v$2);
            _v$3 !== _p$.a && setAttribute(_el$15, "aria-label", _p$.a = _v$3);
            _v$4 !== _p$.o && setAttribute(_el$16, "title", _p$.o = _v$4);
            _v$5 !== _p$.i && setAttribute(_el$16, "aria-label", _p$.i = _v$5);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0,
            i: void 0
          });
          return _el$0;
        })()
      });
    }
  }), createComponent(Show, {
    get when() {
      return editingEntry() !== null;
    },
    children: (_) => {
      const entry = editingEntry();
      return (() => {
        var _el$17 = _tmpl$5$5(), _el$18 = _el$17.firstChild, _el$19 = _el$18.firstChild, _el$20 = _el$19.firstChild, _el$21 = _el$19.nextSibling, _el$22 = _el$21.firstChild, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$22.nextSibling, _el$26 = _el$21.nextSibling, _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling;
        _el$17.addEventListener("close", closeEdit);
        use((el) => {
          if (el) queueMicrotask(() => el.showModal());
        }, _el$17);
        insert(_el$20, () => t("channel.configuration_title", {
          name: entry.name
        }));
        insert(_el$23, () => t("channel.tutorial_hint"));
        insert(_el$24, () => t("channel.tutorial_credit", {
          source: OPENCLAW_DOCS.credit
        }));
        _el$25.$$click = () => nativeOpen(channelTutorialUrl(entry.id));
        insert(_el$25, () => t("channel.tutorial"));
        insert(_el$18, createComponent(For, {
          get each() {
            return entry.fields;
          },
          children: (field) => {
            const name = `channel_${entry.id}_${field.key}`;
            const currentVal = () => fieldValues()[field.key];
            if (field.type === "boolean") {
              return (() => {
                var _el$29 = _tmpl$6$5(), _el$30 = _el$29.firstChild, _el$31 = _el$30.nextSibling;
                insert(_el$30, () => field.label);
                _el$31.addEventListener("change", (e) => handleFieldChange(field.key, e.currentTarget.checked));
                setAttribute(_el$31, "name", name);
                createRenderEffect(() => _el$31.checked = currentVal() !== false);
                return _el$29;
              })();
            }
            const inputType = field.type === "secret" ? "password" : "text";
            return (() => {
              var _el$32 = _tmpl$7$5(), _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling;
              insert(_el$33, () => field.label);
              _el$34.$$input = (e) => handleFieldChange(field.key, e.currentTarget.value);
              setAttribute(_el$34, "type", inputType);
              setAttribute(_el$34, "name", name);
              createRenderEffect(() => setAttribute(_el$34, "placeholder", field.placeholder || ""));
              createRenderEffect(() => _el$34.value = String(currentVal() ?? ""));
              return _el$32;
            })();
          }
        }), _el$26);
        _el$27.$$click = closeEdit;
        insert(_el$27, () => t("common.cancel"));
        _el$28.$$click = handleSaveChannel;
        insert(_el$28, (() => {
          var _c$ = memo(() => !!saving());
          return () => _c$() ? t("common.saving") : t("common.save");
        })());
        createRenderEffect((_p$) => {
          var _v$6 = t("channel.tutorial_hint"), _v$7 = t("channel.tutorial_hint"), _v$8 = saving(), _v$9 = saving();
          _v$6 !== _p$.e && setAttribute(_el$25, "title", _p$.e = _v$6);
          _v$7 !== _p$.t && setAttribute(_el$25, "aria-label", _p$.t = _v$7);
          _v$8 !== _p$.a && (_el$27.disabled = _p$.a = _v$8);
          _v$9 !== _p$.o && (_el$28.disabled = _p$.o = _v$9);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0,
          o: void 0
        });
        return _el$17;
      })();
    }
  })];
}
delegateEvents(["input", "click"]);

var _tmpl$$6 = /* @__PURE__ */ template(`<div class=loading-hint>`), _tmpl$2$5 = /* @__PURE__ */ template(`<div class=config-status-box data-status=error><button type=button class="btn btn-ghost mini">`), _tmpl$3$5 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini">`), _tmpl$4$4 = /* @__PURE__ */ template(`<div class=config-inline-form><label class=field><span class=field-label></span><select class=field-input><option value=path></option><option value=url></option><option value=git></option></select></label><label class=field><span class=field-label></span><div class=field-input-group><input class=field-input type=text></div></label><label class=field><span class=field-label></span><select class=field-input><option value=ask></option><option value=allow></option><option value=deny></option></select></label><div class="dialog-actions compact"><button type=button class="btn btn-ghost"></button><button type=button class="btn btn-primary">`), _tmpl$5$4 = /* @__PURE__ */ template(`<details class=config-subsection open><summary class=config-subsection-head></summary><div class=config-subsection-body><div class=extension-head><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini danger"></button></div></div><div class=extension-list id=skillList>`), _tmpl$6$4 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input type=url placeholder=https://example.com/mcp>`), _tmpl$7$4 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input type=text placeholder=npx>`), _tmpl$8$4 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input type=text placeholder="-y @modelcontextprotocol/server-filesystem C:\\repo">`), _tmpl$9$2 = /* @__PURE__ */ template(`<div class=config-inline-form><label class=field><span class=field-label></span><input class=field-input type=text placeholder=exa></label><label class=field><span class=field-label></span><select class=field-input><option value=remote></option><option value=local></option></select></label><div class="dialog-actions compact"><button type=button class="btn btn-ghost"></button><button type=button class="btn btn-primary">`), _tmpl$0$1 = /* @__PURE__ */ template(`<details class=config-subsection open><summary class=config-subsection-head></summary><div class=config-subsection-body><div class=extension-head><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini danger"></button></div></div><div class=extension-list id=mcpList>`), _tmpl$1 = /* @__PURE__ */ template(`<details class=config-subsection><summary class=config-subsection-head></summary><div class=config-subsection-body><div class=extension-list id=skillMarketList>`), _tmpl$10 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$11 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini danger">`), _tmpl$12 = /* @__PURE__ */ template(`<div class=extension-row><div class=extension-row-main><strong></strong><span></span><small></small></div><div class=extension-row-actions><span class=extension-status data-state=connected>`), _tmpl$13 = /* @__PURE__ */ template(`<div class=extension-row><div class=extension-row-main><strong></strong><span></span></div><span class=extension-status>`), _tmpl$14 = /* @__PURE__ */ template(`<small>`), _tmpl$15 = /* @__PURE__ */ template(`<button type=button class="btn btn-primary mini">`), _tmpl$16 = /* @__PURE__ */ template(`<div class=market-card><div class=market-card-main><strong></strong><span> · <!> · </span><small></small></div><div class=market-card-actions><span class=extension-status>`);
function skillRemoveKind(item) {
  if (item.source_type === "managed_git") return "git";
  if (item.source_type === "config_url") return "url";
  if (item.source_type === "config_path") return "path";
  return "";
}
function skillRemovable(item) {
  return !item.builtin && !!item.source && !!skillRemoveKind(item);
}
function mcpStatusLabel(status) {
  const map = {
    connected: t("mcp.status.connected"),
    disabled: t("mcp.status.disabled"),
    error: t("mcp.status.error"),
    connecting: t("mcp.status.connecting")
  };
  return map[status] || status;
}
function policyLabel(policy) {
  if (policy === "ask") return t("skill.policy.ask");
  if (policy === "allow") return t("skill.policy.allow");
  if (policy === "deny") return t("skill.policy.deny");
  return policy;
}
function SkillMarketPanel() {
  const [notice, setNotice] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const skills = createMemo(() => {
    const raw = appStore.skills;
    return Array.isArray(raw) ? raw : [];
  });
  const mcp = createMemo(() => {
    const raw = appStore.mcp;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  });
  const market = createMemo(() => {
    const raw = appStore.skillMarket;
    return Array.isArray(raw) ? raw : [];
  });
  const customSkills = createMemo(() => skills().filter((item) => !item.builtin));
  const removableSkills = createMemo(() => customSkills().filter(skillRemovable));
  createMemo(() => skills().length - customSkills().length);
  const mcpEntries = createMemo(() => Object.entries(mcp()));
  async function reloadAll() {
    setLoading(true);
    try {
      await Promise.all([loadExtensions(), loadSkillMarket()]);
    } finally {
      setLoading(false);
    }
  }
  async function handleRemoveSkill(source, kind, name) {
    if (!confirm(t("skill.delete_confirm", {
      name
    }))) return;
    try {
      await apiJson("skill/remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source,
          kind
        })
      });
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  async function handleOpenSkill(location) {
    try {
      await nativeOpen(location);
    } catch {
    }
  }
  async function handleDeleteAllSkills() {
    const list = removableSkills();
    if (list.length === 0) return;
    const message = list.length === customSkills().length ? t("skill.delete_all_confirm_all", {
      count: list.length
    }) : t("skill.delete_all_confirm_partial", {
      removable: list.length,
      blocked: customSkills().length - list.length
    });
    if (!confirm(message)) return;
    try {
      for (const item of list) {
        await apiJson("skill/remove", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            source: item.source,
            kind: skillRemoveKind(item)
          })
        });
      }
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  async function handleDeleteAllMcp() {
    const names = mcpEntries().map(([name]) => name);
    if (names.length === 0) return;
    if (!confirm(t("mcp.delete_all_confirm", {
      count: names.length
    }))) return;
    try {
      await Promise.all(names.map((name) => apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, {
        method: "POST"
      }).catch(() => void 0)));
      await Promise.all(names.map((name) => apiJson(`mcp/${encodeURIComponent(name)}/auth`, {
        method: "DELETE"
      }).catch(() => void 0)));
      await updateConfig((current) => {
        delete current.mcp;
      });
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  async function handleInstall(item) {
    if (!item.source || item.install_kind === "manual") return;
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kind: item.install_kind,
          value: item.source,
          policy: item.recommended_policy || void 0
        })
      });
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  async function handleOpenHomepage(url) {
    if (!url) return;
    await nativeOpen(url);
  }
  const [showAddSkill, setShowAddSkill] = createSignal(false);
  const [skillForm, setSkillForm] = createStore({
    type: "path",
    value: "",
    policy: "ask"
  });
  async function handleAddSkill() {
    const value = skillForm.value.trim();
    if (!value) return;
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kind: skillForm.type,
          value,
          policy: skillForm.policy
        })
      });
      setSkillForm({
        type: "path",
        value: "",
        policy: "ask"
      });
      setShowAddSkill(false);
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  async function handleBrowseFolder() {
    try {
      const tauri = window.__TAURI__;
      if (!tauri) return;
      const {
        open
      } = await __vitePreload(async () => { const {
        open
      } = await import('@tauri-apps/plugin-dialog');return {
        open
      }},true              ?[]:void 0);
      const selected = await open({
        directory: true,
        multiple: false
      });
      if (typeof selected === "string") {
        setSkillForm("value", selected);
      }
    } catch {
    }
  }
  async function handleReloadSkills() {
    await reloadAll();
  }
  createEffect(() => {
    if (market().length === 0 && skills().length > 0) {
      loadSkillMarket().catch(() => {
      });
    }
  });
  async function handleOpenSkillDir() {
    try {
      const dirs = await apiJson("skill/directories");
      const target = dirs?.global_config || dirs?.managed_skills;
      if (!target) return;
      await nativeOpen(target);
    } catch {
    }
  }
  const [showAddMcp, setShowAddMcp] = createSignal(false);
  const [mcpForm, setMcpForm] = createStore({
    name: "",
    type: "remote",
    url: "",
    command: "",
    args: ""
  });
  async function handleAddMcp() {
    const name = mcpForm.name.trim();
    if (!name) return;
    const payload = {
      name,
      type: mcpForm.type
    };
    if (mcpForm.type === "remote") {
      payload.url = mcpForm.url.trim();
      if (!payload.url) return;
    } else {
      payload.command = mcpForm.command.trim();
      if (!payload.command) return;
      if (mcpForm.args.trim()) payload.args = mcpForm.args.trim();
    }
    try {
      await apiJson("mcp/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      setMcpForm({
        name: "",
        type: "remote",
        url: "",
        command: "",
        args: ""
      });
      setShowAddMcp(false);
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  return [createComponent(Show, {
    get when() {
      return loading();
    },
    get children() {
      var _el$ = _tmpl$$6();
      insert(_el$, () => t("common.loading"));
      return _el$;
    }
  }), createComponent(Show, {
    get when() {
      return notice();
    },
    get children() {
      var _el$2 = _tmpl$2$5(), _el$3 = _el$2.firstChild;
      insert(_el$2, notice, _el$3);
      _el$3.$$click = () => setNotice("");
      insert(_el$3, () => t("common.dismiss"));
      return _el$2;
    }
  }), (() => {
    var _el$4 = _tmpl$5$4(), _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling, _el$32 = _el$7.nextSibling;
    insert(_el$5, () => t("skill.title"));
    _el$9.$$click = handleReloadSkills;
    insert(_el$9, () => t("common.reload"));
    _el$0.$$click = handleOpenSkillDir;
    insert(_el$0, () => t("skill.open_dir"));
    _el$1.$$click = () => setShowAddSkill(!showAddSkill());
    insert(_el$1, () => t("skill.add"));
    _el$10.$$click = handleDeleteAllSkills;
    insert(_el$10, () => t("skill.delete_all"));
    insert(_el$6, createComponent(Show, {
      get when() {
        return showAddSkill();
      },
      get children() {
        var _el$11 = _tmpl$4$4(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$16.nextSibling, _el$18 = _el$12.nextSibling, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling, _el$21 = _el$20.firstChild, _el$23 = _el$18.nextSibling, _el$24 = _el$23.firstChild, _el$25 = _el$24.nextSibling, _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$28 = _el$27.nextSibling, _el$29 = _el$23.nextSibling, _el$30 = _el$29.firstChild, _el$31 = _el$30.nextSibling;
        insert(_el$13, () => t("skill.source_type"));
        _el$14.addEventListener("change", (e) => setSkillForm("type", e.currentTarget.value));
        insert(_el$15, () => t("skill.source.path"));
        insert(_el$16, () => t("skill.source.url"));
        insert(_el$17, () => t("skill.source.git"));
        insert(_el$19, () => t("skill.value"));
        _el$21.$$input = (e) => setSkillForm("value", e.currentTarget.value);
        insert(_el$20, createComponent(Show, {
          get when() {
            return skillForm.type === "path";
          },
          get children() {
            var _el$22 = _tmpl$3$5();
            _el$22.$$click = handleBrowseFolder;
            insert(_el$22, () => t("skill.browse_folder"));
            return _el$22;
          }
        }), null);
        insert(_el$24, () => t("skill.policy"));
        _el$25.addEventListener("change", (e) => setSkillForm("policy", e.currentTarget.value));
        insert(_el$26, () => t("skill.policy.ask"));
        insert(_el$27, () => t("skill.policy.allow"));
        insert(_el$28, () => t("skill.policy.deny"));
        _el$30.$$click = () => setShowAddSkill(false);
        insert(_el$30, () => t("common.cancel"));
        _el$31.$$click = handleAddSkill;
        insert(_el$31, () => t("skill.install"));
        createRenderEffect((_p$) => {
          var _v$ = t("skill.value_placeholder"), _v$2 = !skillForm.value.trim();
          _v$ !== _p$.e && setAttribute(_el$21, "placeholder", _p$.e = _v$);
          _v$2 !== _p$.t && (_el$31.disabled = _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        createRenderEffect(() => _el$14.value = skillForm.type);
        createRenderEffect(() => _el$21.value = skillForm.value);
        createRenderEffect(() => _el$25.value = skillForm.policy);
        return _el$11;
      }
    }), _el$32);
    insert(_el$32, createComponent(Show, {
      get when() {
        return skills().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$66 = _tmpl$10();
          insert(_el$66, () => t("skill.none_custom"));
          return _el$66;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return skills();
          },
          children: (item) => (() => {
            var _el$67 = _tmpl$12(), _el$68 = _el$67.firstChild, _el$69 = _el$68.firstChild, _el$70 = _el$69.nextSibling, _el$71 = _el$70.nextSibling, _el$72 = _el$68.nextSibling, _el$75 = _el$72.firstChild;
            insert(_el$69, () => item.name);
            insert(_el$70, () => item.description || "");
            insert(_el$71, () => item.location || "");
            insert(_el$72, createComponent(Show, {
              get when() {
                return skillRemovable(item);
              },
              get children() {
                var _el$73 = _tmpl$11();
                _el$73.$$click = () => handleRemoveSkill(item.source || "", skillRemoveKind(item), item.name);
                insert(_el$73, () => t("common.delete"));
                createRenderEffect((_p$) => {
                  var _v$3 = t("skill.delete_button_title"), _v$4 = t("skill.delete_button_title");
                  _v$3 !== _p$.e && setAttribute(_el$73, "title", _p$.e = _v$3);
                  _v$4 !== _p$.t && setAttribute(_el$73, "aria-label", _p$.t = _v$4);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0
                });
                return _el$73;
              }
            }), _el$75);
            insert(_el$72, createComponent(Show, {
              get when() {
                return memo(() => !!item.location)() && item.location !== "builtin";
              },
              get children() {
                var _el$74 = _tmpl$3$5();
                _el$74.$$click = () => handleOpenSkill(item.location);
                insert(_el$74, () => t("common.open"));
                createRenderEffect((_p$) => {
                  var _v$5 = t("skill.open_button_title"), _v$6 = t("skill.open_button_title");
                  _v$5 !== _p$.e && setAttribute(_el$74, "title", _p$.e = _v$5);
                  _v$6 !== _p$.t && setAttribute(_el$74, "aria-label", _p$.t = _v$6);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0
                });
                return _el$74;
              }
            }), _el$75);
            insert(_el$75, (() => {
              var _c$ = memo(() => !!item.builtin);
              return () => _c$() ? t("skill.builtin") : t("common.loaded");
            })());
            return _el$67;
          })()
        });
      }
    }));
    createRenderEffect(() => _el$10.disabled = removableSkills().length === 0);
    return _el$4;
  })(), (() => {
    var _el$33 = _tmpl$0$1(), _el$34 = _el$33.firstChild, _el$35 = _el$34.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$36.firstChild, _el$38 = _el$37.firstChild, _el$39 = _el$38.nextSibling, _el$61 = _el$36.nextSibling;
    insert(_el$34, () => t("mcp.title"));
    _el$38.$$click = () => setShowAddMcp(!showAddMcp());
    insert(_el$38, () => t("mcp.add_action"));
    _el$39.$$click = handleDeleteAllMcp;
    insert(_el$39, () => t("mcp.delete_all"));
    insert(_el$35, createComponent(Show, {
      get when() {
        return showAddMcp();
      },
      get children() {
        var _el$40 = _tmpl$9$2(), _el$41 = _el$40.firstChild, _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling, _el$44 = _el$41.nextSibling, _el$45 = _el$44.firstChild, _el$46 = _el$45.nextSibling, _el$47 = _el$46.firstChild, _el$48 = _el$47.nextSibling, _el$58 = _el$44.nextSibling, _el$59 = _el$58.firstChild, _el$60 = _el$59.nextSibling;
        insert(_el$42, () => t("mcp.name"));
        _el$43.$$input = (e) => setMcpForm("name", e.currentTarget.value);
        insert(_el$45, () => t("mcp.type"));
        _el$46.addEventListener("change", (e) => setMcpForm("type", e.currentTarget.value));
        insert(_el$47, () => t("mcp.type.remote"));
        insert(_el$48, () => t("mcp.type.local"));
        insert(_el$40, createComponent(Show, {
          get when() {
            return mcpForm.type === "remote";
          },
          get children() {
            var _el$49 = _tmpl$6$4(), _el$50 = _el$49.firstChild, _el$51 = _el$50.nextSibling;
            insert(_el$50, () => t("mcp.remote_url"));
            _el$51.$$input = (e) => setMcpForm("url", e.currentTarget.value);
            createRenderEffect(() => _el$51.value = mcpForm.url);
            return _el$49;
          }
        }), _el$58);
        insert(_el$40, createComponent(Show, {
          get when() {
            return mcpForm.type === "local";
          },
          get children() {
            return [(() => {
              var _el$52 = _tmpl$7$4(), _el$53 = _el$52.firstChild, _el$54 = _el$53.nextSibling;
              insert(_el$53, () => t("mcp.command"));
              _el$54.$$input = (e) => setMcpForm("command", e.currentTarget.value);
              createRenderEffect(() => _el$54.value = mcpForm.command);
              return _el$52;
            })(), (() => {
              var _el$55 = _tmpl$8$4(), _el$56 = _el$55.firstChild, _el$57 = _el$56.nextSibling;
              insert(_el$56, () => t("mcp.arguments"));
              _el$57.$$input = (e) => setMcpForm("args", e.currentTarget.value);
              createRenderEffect(() => _el$57.value = mcpForm.args);
              return _el$55;
            })()];
          }
        }), _el$58);
        _el$59.$$click = () => setShowAddMcp(false);
        insert(_el$59, () => t("common.cancel"));
        _el$60.$$click = handleAddMcp;
        insert(_el$60, () => t("mcp.add_action"));
        createRenderEffect(() => _el$60.disabled = !mcpForm.name.trim() || (mcpForm.type === "remote" ? !mcpForm.url.trim() : !mcpForm.command.trim()));
        createRenderEffect(() => _el$43.value = mcpForm.name);
        createRenderEffect(() => _el$46.value = mcpForm.type);
        return _el$40;
      }
    }), _el$61);
    insert(_el$61, createComponent(Show, {
      get when() {
        return mcpEntries().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$76 = _tmpl$10();
          insert(_el$76, () => t("mcp.none"));
          return _el$76;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return mcpEntries();
          },
          children: ([name, item]) => {
            const status = item?.status || "disabled";
            const detail = item?.error || "";
            return (() => {
              var _el$77 = _tmpl$13(), _el$78 = _el$77.firstChild, _el$79 = _el$78.firstChild, _el$80 = _el$79.nextSibling, _el$81 = _el$78.nextSibling;
              insert(_el$79, name);
              insert(_el$80, () => detail ? detail : mcpStatusLabel(status));
              setAttribute(_el$81, "data-state", status);
              insert(_el$81, () => mcpStatusLabel(status));
              return _el$77;
            })();
          }
        });
      }
    }));
    createRenderEffect(() => _el$39.disabled = mcpEntries().length === 0);
    return _el$33;
  })(), (() => {
    var _el$62 = _tmpl$1(), _el$63 = _el$62.firstChild, _el$64 = _el$63.nextSibling, _el$65 = _el$64.firstChild;
    insert(_el$63, () => t("skill.market.title"));
    insert(_el$65, createComponent(Show, {
      get when() {
        return market().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$82 = _tmpl$10();
          insert(_el$82, () => t("skill.market.none"));
          return _el$82;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return market();
          },
          children: (item) => {
            const installable = !!item.source && item.install_kind !== "manual";
            return (() => {
              var _el$83 = _tmpl$16(), _el$84 = _el$83.firstChild, _el$85 = _el$84.firstChild, _el$86 = _el$85.nextSibling, _el$87 = _el$86.firstChild, _el$89 = _el$87.nextSibling; _el$89.nextSibling; var _el$90 = _el$86.nextSibling, _el$92 = _el$84.nextSibling, _el$93 = _el$92.firstChild;
              insert(_el$85, () => item.name);
              insert(_el$86, () => item.provider, _el$87);
              insert(_el$86, () => item.trust, _el$89);
              insert(_el$86, () => item.install_kind, null);
              insert(_el$90, () => item.description || "");
              insert(_el$84, createComponent(Show, {
                get when() {
                  return item.notes;
                },
                get children() {
                  var _el$91 = _tmpl$14();
                  insert(_el$91, () => item.notes);
                  return _el$91;
                }
              }), null);
              insert(_el$93, () => policyLabel(item.recommended_policy || ""));
              insert(_el$92, createComponent(Show, {
                when: installable,
                get fallback() {
                  return (() => {
                    var _el$95 = _tmpl$3$5();
                    _el$95.$$click = () => handleOpenHomepage(item.homepage);
                    insert(_el$95, () => t("skill.market.open_site"));
                    createRenderEffect((_p$) => {
                      var _v$9 = t("skill.market.open_site_title"), _v$0 = t("skill.market.open_site_title");
                      _v$9 !== _p$.e && setAttribute(_el$95, "title", _p$.e = _v$9);
                      _v$0 !== _p$.t && setAttribute(_el$95, "aria-label", _p$.t = _v$0);
                      return _p$;
                    }, {
                      e: void 0,
                      t: void 0
                    });
                    return _el$95;
                  })();
                },
                get children() {
                  var _el$94 = _tmpl$15();
                  _el$94.$$click = () => handleInstall(item);
                  insert(_el$94, () => t("skill.install"));
                  createRenderEffect((_p$) => {
                    var _v$7 = t("skill.market.install_button_title"), _v$8 = t("skill.market.install_button_title");
                    _v$7 !== _p$.e && setAttribute(_el$94, "title", _p$.e = _v$7);
                    _v$8 !== _p$.t && setAttribute(_el$94, "aria-label", _p$.t = _v$8);
                    return _p$;
                  }, {
                    e: void 0,
                    t: void 0
                  });
                  return _el$94;
                }
              }), null);
              createRenderEffect(() => setAttribute(_el$93, "data-state", item.recommended_policy || ""));
              return _el$83;
            })();
          }
        });
      }
    }));
    return _el$62;
  })()];
}
delegateEvents(["click", "input"]);

var _tmpl$$5 = /* @__PURE__ */ template(`<div class=config-panel-card style=opacity:0.6;font-size:var(--ui-font-control);padding:12px>No custom providers configured. Click "+ Add" to add an OpenAI-compatible provider.`), _tmpl$2$4 = /* @__PURE__ */ template(`<label class=field><span class=field-label>Provider ID</span><input class=field-input type=text placeholder="e.g. hexin, my-gateway">`), _tmpl$3$4 = /* @__PURE__ */ template(`<div class=config-panel-card style="margin-top:8px;border:1px solid var(--color-border, #444)"><h4 style="font-size:var(--ui-font-title);margin:0 0 8px 0"></h4><label class=field><span class=field-label>Display Name</span><input class=field-input type=text placeholder="e.g. Hexin OpenAI Gateway"></label><label class=field><span class=field-label>API Base URL</span><input class=field-input type=url placeholder="e.g. https://my-gateway.com/v1"></label><label class=field><span class=field-label>API Key Env Variable</span><input class=field-input type=text placeholder="e.g. MY_API_KEY"></label><label class=field><span class=field-label>Models (one per line: id:display_name)</span><textarea class=field-input rows=4 placeholder="gpt-5.4-mini:GPT-5.4 Mini
gpt-5.4:GPT-5.4"style=font-family:var(--mono);font-size:var(--ui-font-control);resize:vertical></textarea></label><div class="dialog-actions compact"style=margin-top:8px><button type=button class="btn mini">Cancel</button><button type=button class="btn btn-primary mini">`), _tmpl$4$3 = /* @__PURE__ */ template(`<div class=config-panel-group><h4 class=config-panel-group-title>Connected Providers</h4><div class=config-panel-card><div style=font-size:var(--ui-font-control);opacity:0.6;margin-bottom:6px>Auto-detected providers from models.dev, env vars, and auth.`), _tmpl$5$3 = /* @__PURE__ */ template(`<div class=general-panel><div class=config-panel-group><h4 class=config-panel-group-title>Custom Providers<button type=button class="btn btn-primary mini"style=margin-left:auto;font-size:var(--ui-font-meta)>+ Add`), _tmpl$6$3 = /* @__PURE__ */ template(`<div style=font-size:var(--ui-font-control);opacity:0.7;margin-bottom:2px>Env: `), _tmpl$7$3 = /* @__PURE__ */ template(`<div class=config-panel-card style=margin-bottom:8px><div style=display:flex;align-items:center;justify-content:space-between;margin-bottom:4px><strong style=font-size:var(--ui-font-title)></strong><div style=display:flex;gap:6px><button type=button class="btn mini"style="font-size:var(--ui-font-meta);padding:2px 8px">Edit</button><button type=button class="btn mini"style="font-size:var(--ui-font-meta);padding:2px 8px;color:var(--color-danger, #e55)">Delete</button></div></div><div style=font-size:var(--ui-font-control);opacity:0.7;margin-bottom:2px>API: </div><div style=font-size:var(--ui-font-control);opacity:0.7>Models: `), _tmpl$8$3 = /* @__PURE__ */ template(`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--color-border, #333);font-size:var(--ui-font-control)"><span></span><span style=opacity:0.5> models`);
function ProvidersPanel() {
  const [saving, setSaving] = createSignal(false);
  const [editing, setEditing] = createSignal(null);
  const [showAdd, setShowAdd] = createSignal(false);
  const [formId, setFormId] = createSignal("");
  const [formName, setFormName] = createSignal("");
  const [formApi, setFormApi] = createSignal("");
  const [formEnvKey, setFormEnvKey] = createSignal("");
  const [formModels, setFormModels] = createSignal("");
  function configProviders() {
    const cfg = appStore.config;
    const p = cfg?.provider;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    return p;
  }
  function catalogProviders() {
    return appStore.providerCatalog || {};
  }
  function resetForm() {
    setFormId("");
    setFormName("");
    setFormApi("");
    setFormEnvKey("");
    setFormModels("");
  }
  function startAdd() {
    resetForm();
    setEditing(null);
    setShowAdd(true);
  }
  function startEdit(id) {
    const p = configProviders()[id];
    if (!p) return;
    setFormId(id);
    setFormName(p.name || "");
    setFormApi(p.api || "");
    setFormEnvKey(p.env?.[0] || "");
    const modelStr = Object.entries(p.models || {}).map(([mid, m]) => `${mid}:${m.name || mid}`).join("\n");
    setFormModels(modelStr);
    setEditing(id);
    setShowAdd(true);
  }
  function parseModels(text) {
    const models = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      const id = colonIdx > 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
      const name = colonIdx > 0 ? trimmed.slice(colonIdx + 1).trim() : id;
      if (id) {
        models[id] = {
          name: name || id,
          tool_call: true
        };
      }
    }
    return models;
  }
  async function handleSave() {
    const id = editing() || formId().trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    if (!id || !formApi().trim()) return;
    setSaving(true);
    try {
      const provider = {
        name: formName().trim() || id,
        api: formApi().trim().replace(/\/+$/, ""),
        env: formEnvKey().trim() ? [formEnvKey().trim()] : [],
        models: parseModels(formModels())
      };
      await updateConfig((cfg) => {
        cfg.provider = cfg.provider || {};
        cfg.provider[id] = provider;
      });
      const newCfg = await apiJson("config");
      setAppStore("config", newCfg);
      setShowAdd(false);
      resetForm();
      setEditing(null);
    } catch (e) {
      console.error("[providers] save failed", e);
    } finally {
      setSaving(false);
    }
  }
  async function handleDelete(id) {
    setSaving(true);
    try {
      await updateConfig((cfg) => {
        if (cfg.provider) {
          delete cfg.provider[id];
          if (Object.keys(cfg.provider).length === 0) delete cfg.provider;
        }
      });
      const newCfg = await apiJson("config");
      setAppStore("config", newCfg);
    } catch (e) {
      console.error("[providers] delete failed", e);
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setShowAdd(false);
    resetForm();
    setEditing(null);
  }
  const providerEntries = () => Object.entries(configProviders());
  const catalogEntries = () => {
    const custom = new Set(Object.keys(configProviders()));
    return Object.entries(catalogProviders()).filter(([id]) => !custom.has(id)).map(([id, p]) => ({
      id,
      name: p.name || id,
      source: p.source || "auto",
      modelCount: Object.keys(p.models || {}).length
    }));
  };
  return (() => {
    var _el$ = _tmpl$5$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling;
    _el$5.$$click = startAdd;
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => providerEntries().length === 0)() && !showAdd();
      },
      get children() {
        return _tmpl$$5();
      }
    }), null);
    insert(_el$2, createComponent(For, {
      get each() {
        return providerEntries();
      },
      children: ([id, provider]) => (() => {
        var _el$29 = _tmpl$7$3(), _el$30 = _el$29.firstChild, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling, _el$35 = _el$30.nextSibling; _el$35.firstChild; var _el$39 = _el$35.nextSibling; _el$39.firstChild;
        insert(_el$31, () => provider.name || id);
        _el$33.$$click = () => startEdit(id);
        _el$34.$$click = () => handleDelete(id);
        insert(_el$35, () => provider.api, null);
        insert(_el$29, createComponent(Show, {
          get when() {
            return provider.env?.length;
          },
          get children() {
            var _el$37 = _tmpl$6$3(); _el$37.firstChild;
            insert(_el$37, () => provider.env.join(", "), null);
            return _el$37;
          }
        }), _el$39);
        insert(_el$39, () => Object.keys(provider.models || {}).join(", ") || "none", null);
        createRenderEffect(() => _el$34.disabled = saving());
        return _el$29;
      })()
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return showAdd();
      },
      get children() {
        var _el$7 = _tmpl$3$4(), _el$8 = _el$7.firstChild, _el$10 = _el$8.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$10.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$13.nextSibling, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$16.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$19.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling;
        insert(_el$8, (() => {
          var _c$ = memo(() => !!editing());
          return () => _c$() ? `Edit: ${editing()}` : "Add Custom Provider";
        })());
        insert(_el$7, createComponent(Show, {
          get when() {
            return !editing();
          },
          get children() {
            var _el$9 = _tmpl$2$4(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
            _el$1.$$input = (e) => setFormId(e.currentTarget.value);
            createRenderEffect(() => _el$1.value = formId());
            return _el$9;
          }
        }), _el$10);
        _el$12.$$input = (e) => setFormName(e.currentTarget.value);
        _el$15.$$input = (e) => setFormApi(e.currentTarget.value);
        _el$18.$$input = (e) => setFormEnvKey(e.currentTarget.value);
        _el$21.$$input = (e) => setFormModels(e.currentTarget.value);
        _el$23.$$click = cancel;
        _el$24.$$click = handleSave;
        insert(_el$24, (() => {
          var _c$2 = memo(() => !!saving());
          return () => _c$2() ? "Saving..." : editing() ? "Update" : "Add Provider";
        })());
        createRenderEffect(() => _el$24.disabled = saving() || !editing() && !formId().trim() || !formApi().trim());
        createRenderEffect(() => _el$12.value = formName());
        createRenderEffect(() => _el$15.value = formApi());
        createRenderEffect(() => _el$18.value = formEnvKey());
        createRenderEffect(() => _el$21.value = formModels());
        return _el$7;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return catalogEntries().length > 0;
      },
      get children() {
        var _el$25 = _tmpl$4$3(), _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling; _el$27.firstChild;
        insert(_el$27, createComponent(For, {
          get each() {
            return catalogEntries();
          },
          children: (p) => (() => {
            var _el$41 = _tmpl$8$3(), _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling, _el$44 = _el$43.firstChild;
            insert(_el$42, () => p.name);
            insert(_el$43, () => p.modelCount, _el$44);
            return _el$41;
          })()
        }), null);
        return _el$25;
      }
    }), null);
    return _el$;
  })();
}
delegateEvents(["click", "input"]);

var _tmpl$$4 = /* @__PURE__ */ template(`<div class=general-panel><div class=config-panel-group><h4 class=config-panel-group-title></h4><div class=config-panel-card><label class=field><span class=field-label></span><input class=field-input type=url placeholder=http://127.0.0.1:7878></label><label class=field><span class=field-label></span><input class=field-input type=text></label><label class=field><span class=field-label></span><input class=field-input type=password></label><div class="dialog-actions compact"><button type=button class="btn btn-primary mini"></button></div></div></div><div class=config-panel-group><h4 class=config-panel-group-title></h4><div class=config-panel-card><label class=field><span class=field-label></span><select class=field-input><option value=dark></option><option value=vscode-dark></option><option value=light></option><option value=system></option></select></label><label class=field><span class=field-label></span><select class=field-input><option value=zh-CN>中文</option><option value=en-US>English</option></select></label><div class="field opacity-field"><div class=opacity-header><span class=field-label></span><span class=opacity-value>%</span></div><input type=range min=10 max=100 step=1></div></div></div><div class=config-panel-group><h4 class=config-panel-group-title></h4><div class=config-panel-card><div class=config-toggle-list><label class=config-toggle-list-item><span class=toggle-label></span><input type=checkbox></label><label class=config-toggle-list-item><span class=toggle-label></span><input type=checkbox>`);
function GeneralPanel() {
  const [saved, setSaved] = createSignal(false);
  function handleThemeChange(e) {
    const value = e.currentTarget.value;
    setSettingsStore("theme", value);
    saveSettings();
  }
  function handleLocaleChange(e) {
    const value = e.currentTarget.value;
    setSettingsStore("locale", value);
    saveSettings();
  }
  function handleOpacityChange(e) {
    const raw = Number(e.currentTarget.value);
    const value = Math.min(1, Math.max(0.1, raw / 100));
    setSettingsStore("opacity", value);
    saveSettings();
  }
  function handleToggle(key, e) {
    setSettingsStore(key, e.currentTarget.checked);
    saveSettings();
  }
  function handleServerUrlChange(e) {
    setSettingsStore("serverUrl", e.currentTarget.value.trim());
  }
  function handlePasswordChange(e) {
    setSettingsStore("password", e.currentTarget.value);
  }
  function handleUsernameChange(e) {
    setSettingsStore("username", e.currentTarget.value.trim());
  }
  async function handleSaveServer() {
    const url = settingsStore.serverUrl;
    const password = settingsStore.password;
    const username = settingsStore.username;
    configure({
      serverUrl: url,
      password,
      username
    });
    saveSettings();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    try {
      await checkConnection();
      await reloadProjectScope();
    } catch {
    }
  }
  const opacityPercent = () => Math.round(settingsStore.opacity * 100);
  return (() => {
    var _el$ = _tmpl$$4(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$5.nextSibling, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling, _el$1 = _el$8.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$1.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$2.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$16.firstChild, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$21.nextSibling, _el$23 = _el$22.nextSibling, _el$24 = _el$17.nextSibling, _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling, _el$27 = _el$24.nextSibling, _el$28 = _el$27.firstChild, _el$29 = _el$28.firstChild, _el$30 = _el$29.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$28.nextSibling, _el$33 = _el$14.nextSibling, _el$34 = _el$33.firstChild, _el$35 = _el$34.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$36.firstChild, _el$38 = _el$37.firstChild, _el$39 = _el$38.nextSibling, _el$40 = _el$37.nextSibling, _el$41 = _el$40.firstChild, _el$42 = _el$41.nextSibling;
    insert(_el$3, () => t("settings.section.connection"));
    insert(_el$6, () => t("settings.server_url"));
    _el$7.$$input = handleServerUrlChange;
    insert(_el$9, () => t("settings.username"));
    _el$0.$$input = handleUsernameChange;
    insert(_el$10, () => t("settings.password"));
    _el$11.$$input = handlePasswordChange;
    _el$13.$$click = handleSaveServer;
    insert(_el$13, (() => {
      var _c$ = memo(() => !!saved());
      return () => _c$() ? t("common.saved") : t("common.save");
    })());
    insert(_el$15, () => t("settings.section.appearance"));
    insert(_el$18, () => t("settings.theme.label"));
    _el$19.addEventListener("change", handleThemeChange);
    insert(_el$20, () => t("settings.theme.dark"));
    insert(_el$21, () => t("settings.theme.vscode_dark"));
    insert(_el$22, () => t("settings.theme.light"));
    insert(_el$23, () => t("settings.theme.system"));
    insert(_el$25, () => t("settings.locale.label"));
    _el$26.addEventListener("change", handleLocaleChange);
    insert(_el$29, () => t("settings.opacity.label"));
    insert(_el$30, opacityPercent, _el$31);
    _el$32.addEventListener("change", handleOpacityChange);
    _el$32.$$input = handleOpacityChange;
    insert(_el$34, () => t("settings.section.behaviour"));
    insert(_el$38, () => t("settings.always_on_top"));
    _el$39.addEventListener("change", (e) => handleToggle("alwaysOnTop", e));
    insert(_el$41, () => t("settings.show_transcript_details"));
    _el$42.addEventListener("change", (e) => handleToggle("showTranscriptDetails", e));
    createRenderEffect(() => _el$7.value = settingsStore.serverUrl);
    createRenderEffect(() => _el$0.value = settingsStore.username);
    createRenderEffect(() => _el$11.value = settingsStore.password);
    createRenderEffect(() => _el$19.value = settingsStore.theme);
    createRenderEffect(() => _el$26.value = settingsStore.locale);
    createRenderEffect(() => _el$32.value = opacityPercent());
    createRenderEffect(() => _el$39.checked = settingsStore.alwaysOnTop);
    createRenderEffect(() => _el$42.checked = settingsStore.showTranscriptDetails);
    return _el$;
  })();
}
delegateEvents(["input", "click"]);

var _tmpl$$3 = /* @__PURE__ */ template(`<details class=orch-agent-card><summary class=orch-agent-header></summary><div class=orch-agent-body>`), _tmpl$2$3 = /* @__PURE__ */ template(`<div class=orch-field><label class=orch-field-label>`), _tmpl$3$3 = /* @__PURE__ */ template(`<input class=orch-field-input type=number>`), _tmpl$4$2 = /* @__PURE__ */ template(`<select class=orch-field-select>`), _tmpl$5$2 = /* @__PURE__ */ template(`<option>`), _tmpl$6$2 = /* @__PURE__ */ template(`<span class=orch-toggle-desc>`), _tmpl$7$2 = /* @__PURE__ */ template(`<label class=orch-toggle><input type=checkbox><span class=orch-toggle-label>`), _tmpl$8$2 = /* @__PURE__ */ template(`<div class=orch-panel><section class=orch-section><h3 class=orch-section-title></h3><div class=orch-field><label class=orch-field-label></label><select class=orch-field-select><option value=standard>Standard</option><option value=quick-fix>Quick Fix</option><option value=plan-only>Plan Only</option></select></div></section><section class=orch-section><h3 class=orch-section-title></h3></section><section class=orch-section><h3 class=orch-section-title></h3><div class=orch-field><label class=orch-field-label>Max Runs</label><input class=orch-field-input type=number></div><div class=orch-field><label class=orch-field-label>Max Fix Runs</label><input class=orch-field-input type=number></div><div class=orch-field><label class=orch-field-label>Max Executor Groups</label><input class=orch-field-input type=number></div></section><section class=orch-section><h3 class=orch-section-title>`);
async function patchConfig$1(patch) {
  const {
    patchConfig: doPatch
  } = await __vitePreload(async () => { const {
    patchConfig: doPatch
  } = await Promise.resolve().then(() => config);return {
    patchConfig: doPatch
  }},true              ?void 0:void 0);
  await doPatch(patch);
}
function assistantConfig() {
  return appStore.config?.assistant ?? {};
}
function experimentalConfig() {
  return appStore.config?.experimental ?? {};
}
function agentConfig(name) {
  return assistantConfig()[name] ?? {};
}
function AgentConfigCard(props) {
  const cfg = createMemo(() => agentConfig(props.name));
  function updateField(key, value) {
    void patchConfig$1({
      assistant: {
        [props.name]: {
          [key]: value
        }
      }
    });
  }
  return (() => {
    var _el$ = _tmpl$$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
    insert(_el$2, () => props.label);
    insert(_el$3, createComponent(For, {
      get each() {
        return props.fields;
      },
      children: (field) => (() => {
        var _el$4 = _tmpl$2$3(), _el$5 = _el$4.firstChild;
        insert(_el$5, () => field.label);
        insert(_el$4, (() => {
          var _c$ = memo(() => field.type === "number");
          return () => _c$() ? (() => {
            var _el$6 = _tmpl$3$3();
            _el$6.addEventListener("change", (e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) updateField(field.key, v);
            });
            createRenderEffect(() => _el$6.value = cfg()[field.key] ?? "");
            return _el$6;
          })() : memo(() => !!(field.type === "select" && field.options))() ? (() => {
            var _el$7 = _tmpl$4$2();
            _el$7.addEventListener("change", (e) => updateField(field.key, e.currentTarget.value));
            insert(_el$7, createComponent(For, {
              get each() {
                return field.options;
              },
              children: (opt) => (() => {
                var _el$8 = _tmpl$5$2();
                _el$8.value = opt;
                insert(_el$8, opt);
                return _el$8;
              })()
            }));
            createRenderEffect(() => _el$7.value = String(cfg()[field.key] ?? ""));
            return _el$7;
          })() : null;
        })(), null);
        return _el$4;
      })()
    }));
    return _el$;
  })();
}
function Toggle(props) {
  return (() => {
    var _el$9 = _tmpl$7$2(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
    _el$0.addEventListener("change", (e) => props.onChange(e.currentTarget.checked));
    insert(_el$1, () => props.label);
    insert(_el$9, createComponent(Show, {
      get when() {
        return props.description;
      },
      get children() {
        var _el$10 = _tmpl$6$2();
        insert(_el$10, () => props.description);
        return _el$10;
      }
    }), null);
    createRenderEffect(() => _el$0.checked = props.checked);
    return _el$9;
  })();
}
function OrchestrationPanel() {
  const defaultWorkflow = createMemo(() => assistantConfig().default_workflow ?? "standard");
  return (() => {
    var _el$11 = _tmpl$8$2(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$12.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$17.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$21.firstChild, _el$23 = _el$22.nextSibling, _el$24 = _el$21.nextSibling, _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling, _el$27 = _el$24.nextSibling, _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling, _el$30 = _el$19.nextSibling, _el$31 = _el$30.firstChild;
    insert(_el$13, () => t("orchestration.workflow"));
    insert(_el$15, () => t("orchestration.default_workflow"));
    _el$16.addEventListener("change", (e) => void patchConfig$1({
      assistant: {
        default_workflow: e.currentTarget.value
      }
    }));
    insert(_el$18, () => t("orchestration.agent_config"));
    insert(_el$17, createComponent(AgentConfigCard, {
      name: "decompose",
      get label() {
        return t("orchestration.agent_requirements");
      },
      fields: [{
        key: "max_steps",
        label: "Max Steps",
        type: "number"
      }, {
        key: "timeout_ms",
        label: "Timeout (ms)",
        type: "number"
      }, {
        key: "quality_threshold",
        label: "Quality Threshold",
        type: "number"
      }, {
        key: "max_attempts",
        label: "Max Attempts",
        type: "number"
      }]
    }), null);
    insert(_el$17, createComponent(AgentConfigCard, {
      name: "architect",
      get label() {
        return t("orchestration.agent_architect");
      },
      fields: [{
        key: "max_steps",
        label: "Max Steps",
        type: "number"
      }, {
        key: "timeout_ms",
        label: "Timeout (ms)",
        type: "number"
      }]
    }), null);
    insert(_el$17, createComponent(AgentConfigCard, {
      name: "planner",
      get label() {
        return t("orchestration.agent_planner");
      },
      fields: [{
        key: "max_steps",
        label: "Max Steps",
        type: "number"
      }, {
        key: "timeout_ms",
        label: "Timeout (ms)",
        type: "number"
      }, {
        key: "quality_threshold",
        label: "Quality Threshold",
        type: "number"
      }]
    }), null);
    insert(_el$17, createComponent(AgentConfigCard, {
      name: "evaluator",
      get label() {
        return t("orchestration.agent_evaluator");
      },
      fields: [{
        key: "max_steps",
        label: "Max Steps",
        type: "number"
      }, {
        key: "timeout_ms",
        label: "Timeout (ms)",
        type: "number"
      }, {
        key: "tier",
        label: "Tier",
        type: "select",
        options: ["core", "standard", "full"]
      }]
    }), null);
    insert(_el$17, createComponent(AgentConfigCard, {
      name: "delivery",
      get label() {
        return t("orchestration.agent_delivery");
      },
      fields: [{
        key: "max_steps",
        label: "Max Steps",
        type: "number"
      }, {
        key: "timeout_ms",
        label: "Timeout (ms)",
        type: "number"
      }, {
        key: "max_retries",
        label: "Max Retries",
        type: "number"
      }]
    }), null);
    insert(_el$20, () => t("orchestration.limits"));
    _el$23.addEventListener("change", (e) => {
      const v = parseInt(e.currentTarget.value, 10);
      if (Number.isFinite(v)) void patchConfig$1({
        assistant: {
          max_runs: v
        }
      });
    });
    _el$26.addEventListener("change", (e) => {
      const v = parseInt(e.currentTarget.value, 10);
      if (Number.isFinite(v)) void patchConfig$1({
        assistant: {
          max_fix_runs: v
        }
      });
    });
    _el$29.addEventListener("change", (e) => {
      const v = parseInt(e.currentTarget.value, 10);
      if (Number.isFinite(v)) void patchConfig$1({
        assistant: {
          max_executor_groups: v
        }
      });
    });
    insert(_el$31, () => t("orchestration.behavior"));
    insert(_el$30, createComponent(Toggle, {
      get label() {
        return t("settings.unattended");
      },
      get checked() {
        return !!experimentalConfig().unattended;
      },
      onChange: (v) => void patchConfig$1({
        experimental: {
          unattended: v
        }
      }),
      get description() {
        return t("orchestration.unattended_desc");
      }
    }), null);
    insert(_el$30, createComponent(Toggle, {
      get label() {
        return t("settings.auto_permission");
      },
      get checked() {
        return !!experimentalConfig().auto_permission;
      },
      onChange: (v) => void patchConfig$1({
        experimental: {
          auto_permission: v
        }
      })
    }), null);
    insert(_el$30, createComponent(Toggle, {
      get label() {
        return t("settings.auto_question");
      },
      get checked() {
        return !!experimentalConfig().auto_question;
      },
      onChange: (v) => void patchConfig$1({
        experimental: {
          auto_question: v
        }
      })
    }), null);
    createRenderEffect(() => _el$16.value = defaultWorkflow());
    createRenderEffect(() => _el$23.value = assistantConfig().max_runs ?? 10);
    createRenderEffect(() => _el$26.value = assistantConfig().max_fix_runs ?? 5);
    createRenderEffect(() => _el$29.value = assistantConfig().max_executor_groups ?? 1);
    return _el$11;
  })();
}

var _tmpl$$2 = /* @__PURE__ */ template(`<div class=perm-row><div class=perm-row-info><span class=perm-row-label></span><span class=perm-row-desc></span></div><div class=perm-row-actions>`), _tmpl$2$2 = /* @__PURE__ */ template(`<button class=perm-action-btn>`), _tmpl$3$2 = /* @__PURE__ */ template(`<div class=perm-panel><p class=perm-panel-intro></p><div class=perm-list>`);
async function patchConfig(patch) {
  const {
    patchConfig: doPatch
  } = await __vitePreload(async () => { const {
    patchConfig: doPatch
  } = await Promise.resolve().then(() => config);return {
    patchConfig: doPatch
  }},true              ?void 0:void 0);
  await doPatch(patch);
}
const PERM_ROWS = [{
  key: "websearch",
  label: () => t("permissions.websearch"),
  desc: () => t("permissions.websearch_desc")
}, {
  key: "webfetch",
  label: () => t("permissions.webfetch"),
  desc: () => t("permissions.webfetch_desc")
}, {
  key: "skill",
  label: () => t("permissions.skill"),
  desc: () => t("permissions.skill_desc")
}, {
  key: "external_directory",
  label: () => t("permissions.external_directory"),
  desc: () => t("permissions.external_directory_desc")
}, {
  key: "task",
  label: () => t("permissions.task"),
  desc: () => t("permissions.task_desc")
}, {
  key: "schedule",
  label: () => t("permissions.schedule"),
  desc: () => t("permissions.schedule_desc")
}];
const ACTION_OPTIONS = [{
  value: "allow",
  label: () => t("permissions.action_allow")
}, {
  value: "ask",
  label: () => t("permissions.action_ask")
}, {
  value: "deny",
  label: () => t("permissions.action_deny")
}];
function toolPerms() {
  return appStore.config?.tool_permissions ?? {};
}
function currentAction(key) {
  return toolPerms()[key] ?? "allow";
}
function setPermission(key, action) {
  void patchConfig({
    tool_permissions: {
      [key]: action
    }
  });
}
function PermRow(props) {
  return (() => {
    var _el$ = _tmpl$$2(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$2.nextSibling;
    insert(_el$3, () => props.label());
    insert(_el$4, () => props.desc());
    insert(_el$5, createComponent(For, {
      each: ACTION_OPTIONS,
      children: (opt) => (() => {
        var _el$6 = _tmpl$2$2();
        _el$6.$$click = () => setPermission(props.key, opt.value);
        insert(_el$6, () => opt.label());
        createRenderEffect((_p$) => {
          var _v$ = currentAction(props.key) === opt.value ? "true" : void 0, _v$2 = opt.value, _v$3 = opt.label();
          _v$ !== _p$.e && setAttribute(_el$6, "data-active", _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$6, "data-action", _p$.t = _v$2);
          _v$3 !== _p$.a && setAttribute(_el$6, "title", _p$.a = _v$3);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0
        });
        return _el$6;
      })()
    }));
    return _el$;
  })();
}
function PermissionsPanel() {
  return (() => {
    var _el$7 = _tmpl$3$2(), _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling;
    insert(_el$8, () => t("permissions.intro"));
    insert(_el$9, createComponent(For, {
      each: PERM_ROWS,
      children: (row) => createComponent(PermRow, row)
    }));
    return _el$7;
  })();
}
delegateEvents(["click"]);

var _tmpl$$1 = /* @__PURE__ */ template(`<div class=config-status-box data-status=error>`), _tmpl$2$1 = /* @__PURE__ */ template(`<div class=loading-hint>`), _tmpl$3$1 = /* @__PURE__ */ template(`<dialog class=dialog><div class=dialog-form><div class=dialog-head><span class=dialog-title></span></div><div class=dialog-actions><button type=button class="btn btn-ghost mini danger"></button><button type=button class="btn btn-ghost">`), _tmpl$4$1 = /* @__PURE__ */ template(`<div class=memory-detail-meta><span class=knowledge-scope></span><span></span><span></span><span>`), _tmpl$5$1 = /* @__PURE__ */ template(`<pre class=memory-detail-content>`), _tmpl$6$1 = /* @__PURE__ */ template(`<div class=knowledge-toolbar><input id=memorySearch type=text class=knowledge-search><button type=button id=btnMemorySearch class="btn btn-ghost mini"></button><button type=button id=btnMemoryRefresh class="btn btn-ghost mini">`), _tmpl$7$1 = /* @__PURE__ */ template(`<div id=memoryList class=knowledge-list>`), _tmpl$8$1 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$9$1 = /* @__PURE__ */ template(`<div class=knowledge-item-meta>`), _tmpl$0 = /* @__PURE__ */ template(`<div class=knowledge-item role=button tabindex=0><div class=knowledge-item-main><div class=knowledge-item-title></div><div class=knowledge-item-meta></div></div><div class=knowledge-item-actions><span class=knowledge-scope></span><button type=button class="btn btn-ghost mini danger knowledge-delete"data-action=delete-memory>`);
function knowledgeScopeLabel(scope) {
  if (scope === "session") return t("memory.scope.session");
  if (scope === "cwd") return t("memory.scope.cwd");
  if (scope === "global") return t("memory.scope.global");
  return scope || "";
}
function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString();
}
function formatDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}
function MemoryDetailDialog(props) {
  let dialogRef;
  const [detail, setDetail] = createSignal(null);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const load = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await apiJson(`panel/knowledge/memory/${encodeURIComponent(props.fileId)}`);
      const f = data.file;
      setDetail({
        title: f.title,
        scope: f.scope,
        source: f.source,
        timeCreated: f.timeCreated,
        timeUpdated: f.timeUpdated,
        content: data.content || ""
      });
    } catch (e) {
      setErrorMsg(e?.message || t("memory.load_failed"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };
  const handleDelete = async () => {
    try {
      await apiJson(`panel/knowledge/memory/${encodeURIComponent(props.fileId)}`, {
        method: "DELETE"
      });
      dialogRef?.close();
      props.onDeleted();
    } catch {
    }
  };
  load();
  return (() => {
    var _el$ = _tmpl$3$1(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$7 = _el$3.nextSibling, _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling;
    addEventListener(_el$, "close", props.onClose);
    use((el) => {
      dialogRef = el;
      if (el) queueMicrotask(() => el.showModal());
    }, _el$);
    insert(_el$4, (() => {
      var _c$ = memo(() => !!loading());
      return () => _c$() ? t("common.loading") : memo(() => !!errorMsg())() ? t("common.error") : detail()?.title ?? "";
    })());
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => !!(!loading() && !errorMsg()))() && detail() !== null;
      },
      children: (_) => {
        const d = detail();
        return [(() => {
          var _el$0 = _tmpl$4$1(), _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$10.nextSibling, _el$12 = _el$11.nextSibling;
          insert(_el$1, () => knowledgeScopeLabel(d.scope));
          insert(_el$10, () => t("memory.source", {
            value: d.source
          }));
          insert(_el$11, () => t("memory.created", {
            value: formatDateTime(d.timeCreated)
          }));
          insert(_el$12, () => t("memory.updated", {
            value: formatDateTime(d.timeUpdated)
          }));
          createRenderEffect(() => setAttribute(_el$1, "data-scope", d.scope));
          return _el$0;
        })(), (() => {
          var _el$13 = _tmpl$5$1();
          insert(_el$13, () => d.content || t("memory.empty_value"));
          return _el$13;
        })()];
      }
    }), _el$7);
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => !!!loading())() && !!errorMsg();
      },
      get children() {
        var _el$5 = _tmpl$$1();
        insert(_el$5, errorMsg);
        return _el$5;
      }
    }), _el$7);
    insert(_el$2, createComponent(Show, {
      get when() {
        return loading();
      },
      get children() {
        var _el$6 = _tmpl$2$1();
        insert(_el$6, () => t("common.loading"));
        return _el$6;
      }
    }), _el$7);
    _el$8.$$click = () => void handleDelete();
    insert(_el$8, () => t("common.delete"));
    _el$9.$$click = () => {
      dialogRef?.close();
      props.onClose();
    };
    insert(_el$9, () => t("common.close"));
    return _el$;
  })();
}
function MemoryPanel(props) {
  const [files, setFiles] = createSignal([]);
  const [searchMode, setSearchMode] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [detailFileId, setDetailFileId] = createSignal(null);
  const loadMemory = async () => {
    if (!props.taskID) {
      setFiles([]);
      setSearchMode(false);
      return;
    }
    setLoading(true);
    try {
      const query = `?taskID=${encodeURIComponent(props.taskID)}`;
      const data = await apiJson(`panel/knowledge/memory${query}`);
      setFiles(Array.isArray(data) ? data : []);
      setSearchMode(false);
    } catch {
      setFiles([]);
      setSearchMode(false);
    } finally {
      setLoading(false);
    }
  };
  const doSearch = async (q) => {
    if (!q || !q.trim()) {
      return loadMemory();
    }
    setLoading(true);
    try {
      const results = await apiJson("panel/knowledge/memory/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: q.trim(),
          taskID: props.taskID || void 0,
          limit: 20
        })
      });
      const mapped = (Array.isArray(results) ? results : []).map((r) => ({
        id: r.fileId,
        title: r.fileTitle,
        scope: r.scope || "global",
        source: t("memory.search_source"),
        score: r.score,
        snippet: r.content ? r.content.slice(0, 200) : "",
        timeUpdated: r.timeCreated || 0
      }));
      setFiles(mapped);
      setSearchMode(true);
    } catch {
    } finally {
      setLoading(false);
    }
  };
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    void doSearch(searchQuery());
  };
  const handleRefresh = () => {
    setSearchQuery("");
    void loadMemory();
  };
  const handleDeleteInline = async (fileId) => {
    try {
      await apiJson(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, {
        method: "DELETE"
      });
      await loadMemory();
    } catch {
    }
  };
  createEffect(() => {
    props.taskID;
    void loadMemory();
  });
  createMemo(() => {
    const n = files().length;
    return n > 0 ? String(n) : "";
  });
  const emptyHint = createMemo(() => {
    if (searchMode()) return t("memory.no_results");
    if (props.taskID) return t("memory.none");
    return t("memory.none_unselected");
  });
  return [(() => {
    var _el$14 = _tmpl$6$1(), _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$16.nextSibling;
    _el$15.$$keydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void doSearch(searchQuery());
      }
    };
    _el$15.$$input = (e) => setSearchQuery(e.target.value);
    _el$16.$$click = handleSearchSubmit;
    insert(_el$16, () => t("common.search"));
    _el$17.$$click = handleRefresh;
    insert(_el$17, () => t("common.refresh"));
    createRenderEffect((_p$) => {
      var _v$ = t("memory.search_placeholder"), _v$2 = loading(), _v$3 = loading();
      _v$ !== _p$.e && setAttribute(_el$15, "placeholder", _p$.e = _v$);
      _v$2 !== _p$.t && (_el$16.disabled = _p$.t = _v$2);
      _v$3 !== _p$.a && (_el$17.disabled = _p$.a = _v$3);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    createRenderEffect(() => _el$15.value = searchQuery());
    return _el$14;
  })(), (() => {
    var _el$18 = _tmpl$7$1();
    insert(_el$18, createComponent(Show, {
      get when() {
        return files().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$19 = _tmpl$8$1();
          insert(_el$19, emptyHint);
          return _el$19;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return files();
          },
          children: (f) => {
            const time = formatDate(f.timeUpdated);
            const mode = searchMode() ? "search" : "list";
            const scoreHint = f.score != null ? ` · ${t("memory.score", {
              value: f.score.toFixed(2)
            })}` : "";
            const meta = `${f.source}${scoreHint}${time ? ` · ${time}` : ""}`;
            return (() => {
              var _el$20 = _tmpl$0(), _el$21 = _el$20.firstChild, _el$22 = _el$21.firstChild, _el$23 = _el$22.nextSibling, _el$25 = _el$21.nextSibling, _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling;
              _el$20.$$keydown = (e) => {
                if (e.key === "Enter" || e.key === " ") setDetailFileId(f.id);
              };
              _el$20.$$click = () => setDetailFileId(f.id);
              setAttribute(_el$20, "data-mode", mode);
              insert(_el$22, () => f.title);
              insert(_el$23, meta);
              insert(_el$21, createComponent(Show, {
                get when() {
                  return !!f.snippet;
                },
                get children() {
                  var _el$24 = _tmpl$9$1();
                  insert(_el$24, () => f.snippet);
                  return _el$24;
                }
              }), null);
              insert(_el$26, () => knowledgeScopeLabel(f.scope));
              _el$27.$$click = (e) => {
                e.stopPropagation();
                void handleDeleteInline(f.id);
              };
              insert(_el$27, () => t("common.delete"));
              createRenderEffect((_p$) => {
                var _v$4 = f.id, _v$5 = f.scope, _v$6 = f.id, _v$7 = t("memory.delete_button_title"), _v$8 = t("memory.delete_button_title");
                _v$4 !== _p$.e && setAttribute(_el$20, "data-id", _p$.e = _v$4);
                _v$5 !== _p$.t && setAttribute(_el$26, "data-scope", _p$.t = _v$5);
                _v$6 !== _p$.a && setAttribute(_el$27, "data-id", _p$.a = _v$6);
                _v$7 !== _p$.o && setAttribute(_el$27, "title", _p$.o = _v$7);
                _v$8 !== _p$.i && setAttribute(_el$27, "aria-label", _p$.i = _v$8);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0,
                o: void 0,
                i: void 0
              });
              return _el$20;
            })();
          }
        });
      }
    }));
    return _el$18;
  })(), createComponent(Show, {
    get when() {
      return detailFileId() !== null;
    },
    get children() {
      return createComponent(MemoryDetailDialog, {
        get fileId() {
          return detailFileId();
        },
        get taskID() {
          return props.taskID;
        },
        onClose: () => setDetailFileId(null),
        onDeleted: () => {
          setDetailFileId(null);
          void loadMemory();
        }
      });
    }
  })];
}
delegateEvents(["click", "input", "keydown"]);

var _tmpl$ = /* @__PURE__ */ template(`<div class=interaction-panel-empty>`), _tmpl$2 = /* @__PURE__ */ template(`<div class=interaction-panel>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="interaction-body md-content">`), _tmpl$4 = /* @__PURE__ */ template(`<div class=interaction-error>`), _tmpl$5 = /* @__PURE__ */ template(`<button class="btn btn-primary">`), _tmpl$6 = /* @__PURE__ */ template(`<button class="btn btn-ghost">`), _tmpl$7 = /* @__PURE__ */ template(`<div class=interaction-alert><div class=interaction-title> </div><div class=interaction-actions>`), _tmpl$8 = /* @__PURE__ */ template(`<div class=interaction-auto-answer>`), _tmpl$9 = /* @__PURE__ */ template(`<div class="interaction-alert interaction-auto-replied"><div class=interaction-title><span class=interaction-auto-badge></span> `);
function isRecord$1(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function interactionIcon(interaction) {
  return interaction.type === "permission" ? "🔒" : "❓";
}
function interactionAnswerLines(interaction) {
  const response = isRecord$1(interaction?.response) ? interaction.response : null;
  const payload = isRecord$1(interaction?.payload) ? interaction.payload : null;
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (Array.isArray(response?.answers)) {
    return response.answers.flatMap((answer, index) => {
      const value = Array.isArray(answer) ? answer.filter((item) => typeof item === "string" && item.trim()).join(", ") : "";
      if (!value) return [];
      const question = isRecord$1(questions[index]) ? questions[index] : null;
      const label = typeof question?.header === "string" && question.header.trim() ? question.header.trim() : typeof question?.question === "string" && question.question.trim() ? question.question.trim() : "";
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  if (isRecord$1(response?.answers)) {
    return Object.entries(response.answers).flatMap(([key, item], index) => {
      const answer = isRecord$1(item) ? item : null;
      const value = Array.isArray(answer?.answers) ? answer.answers.filter((entry) => typeof entry === "string" && entry.trim()).join(", ") : "";
      if (!value) return [];
      const question = isRecord$1(questions[index]) ? questions[index] : null;
      const label = typeof question?.header === "string" && question.header.trim() ? question.header.trim() : typeof question?.question === "string" && question.question.trim() ? question.question.trim() : key;
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  const message = typeof response?.message === "string" ? response.message.trim() : "";
  return message ? [message] : [];
}
function interactionReplyLabel(reply) {
  if (reply === "always") return t("interaction.always_allow");
  if (reply === "reject") return t("interaction.reject");
  return t("interaction.allow_once");
}
function autoInteractionAnswers(interaction) {
  const payload = isRecord$1(interaction?.payload) ? interaction.payload : null;
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (questions.length === 0) return null;
  return questions.map((item) => {
    const question = isRecord$1(item) ? item : null;
    const options = Array.isArray(question?.options) ? question.options : [];
    const selected = options.find((option) => isRecord$1(option) && typeof option.label === "string" && option.label.trim());
    if (selected && typeof selected.label === "string") return [selected.label.trim()];
    return null;
  });
}
function shouldAutoResolve(interaction) {
  if (!interaction || interaction.status !== "pending") return false;
  const exp = appStore.config?.experimental;
  if (interaction.type === "permission") return exp?.auto_permission === true;
  if (interaction.type === "question") return exp?.auto_question === true || exp?.unattended !== false;
  return false;
}
function interactionResponseSummary(interaction) {
  if (interaction.type === "permission") {
    const reply = interaction.response?.reply;
    return typeof reply === "string" ? interactionReplyLabel(reply) : t("interaction.allow_once");
  }
  const lines = interactionAnswerLines(interaction);
  if (lines.length > 0) return lines.join("\n");
  return t("interaction.answer");
}
function InteractionPanel(props) {
  const [busy, setBusy] = createSignal(false);
  const [errorMap, setErrorMap] = createSignal({});
  const autoResolveFailed = /* @__PURE__ */ new Map();
  const COOLDOWN_MS = 1e4;
  const pendingInteractions = createMemo(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item) => item?.status === "pending");
  });
  const recentAutoReplies = createMemo(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const WINDOW_MS = 6e4;
    return raw.filter((item) => item?.status === "answered" && item?.response?.auto_reply === true && item?.time?.resolved && now - item.time.resolved < WINDOW_MS).sort((a, b) => (b.time?.resolved ?? 0) - (a.time?.resolved ?? 0)).slice(0, 5);
  });
  function setError(id, msg) {
    setErrorMap((prev) => ({
      ...prev,
      [id]: msg
    }));
  }
  function clearError(id) {
    setErrorMap((prev) => {
      const next = {
        ...prev
      };
      delete next[id];
      return next;
    });
  }
  async function resolveInteraction(id, action, input = {}) {
    if (busy()) return;
    setBusy(true);
    clearError(id);
    autoResolveFailed.delete(id);
    try {
      if (action === "once" || action === "always") {
        await apiJson(`interaction/${id}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            reply: action
          }),
          signal: AbortSignal.timeout(3e4)
        });
        props.onRespond?.(id, {
          reply: action
        });
        return;
      }
      const answers = Array.isArray(input.answers) ? input.answers : null;
      const message = typeof input.message === "string" && input.message.trim() ? input.message.trim() : "";
      await apiJson(`interaction/${id}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...answers ? {
            answers
          } : {},
          ...message ? {
            message
          } : {}
        }),
        signal: AbortSignal.timeout(3e4)
      });
      props.onRespond?.(id, {
        answers,
        message
      });
    } catch (error) {
      console.error("[InteractionPanel] resolveInteraction failed", error);
      const msg = error?.message || String(error);
      setError(id, msg);
      autoResolveFailed.set(id, Date.now());
    } finally {
      setBusy(false);
    }
  }
  async function rejectInteraction(id) {
    if (busy()) return;
    setBusy(true);
    clearError(id);
    try {
      await apiJson(`interaction/${id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(3e4)
      });
      props.onRespond?.(id, {
        rejected: true
      });
    } catch (error) {
      console.error("[InteractionPanel] rejectInteraction failed", error);
      setError(id, error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }
  function tryAutoResolve(interaction) {
    if (busy()) return;
    if (!shouldAutoResolve(interaction)) return;
    const lastFail = autoResolveFailed.get(interaction.id);
    if (lastFail && Date.now() - lastFail < COOLDOWN_MS) return;
    if (interaction.type === "permission") {
      const reply = appStore.config?.experimental?.auto_permission ? "always" : "once";
      void resolveInteraction(interaction.id, reply);
      return;
    }
    const answers = autoInteractionAnswers(interaction);
    if (!answers || answers.some((item) => !Array.isArray(item) || item.length === 0)) {
      console.warn("[InteractionPanel] Skipping auto question reply — missing structured options", {
        interactionID: interaction.id
      });
      return;
    }
    void resolveInteraction(interaction.id, "answer", {
      answers
    });
  }
  const firstPending = createMemo(() => pendingInteractions()[0] ?? null);
  let lastAutoId = "";
  createMemo(() => {
    const interaction = firstPending();
    if (!interaction) {
      lastAutoId = "";
      return;
    }
    if (interaction.id === lastAutoId) return;
    lastAutoId = interaction.id;
    queueMicrotask(() => tryAutoResolve(interaction));
  });
  return (() => {
    var _el$ = _tmpl$2();
    insert(_el$, createComponent(For, {
      get each() {
        return pendingInteractions();
      },
      children: (interaction) => (() => {
        var _el$3 = _tmpl$7(), _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$8 = _el$4.nextSibling;
        insert(_el$4, () => interactionIcon(interaction), _el$5);
        insert(_el$4, () => interaction.title, null);
        insert(_el$3, createComponent(Show, {
          get when() {
            return interaction.body;
          },
          get children() {
            var _el$6 = _tmpl$3();
            insert(_el$6, () => interaction.body);
            return _el$6;
          }
        }), _el$8);
        insert(_el$3, createComponent(Show, {
          get when() {
            return errorMap()[interaction.id];
          },
          get children() {
            var _el$7 = _tmpl$4();
            insert(_el$7, () => t("interaction.error", {
              message: errorMap()[interaction.id]
            }));
            return _el$7;
          }
        }), _el$8);
        insert(_el$8, createComponent(Show, {
          get when() {
            return interaction.type === "permission";
          },
          get fallback() {
            return [(() => {
              var _el$10 = _tmpl$5();
              _el$10.$$click = () => resolveInteraction(interaction.id, "answer");
              insert(_el$10, () => t("interaction.answer"));
              createRenderEffect((_p$) => {
                var _v$0 = busy(), _v$1 = t("interaction.answer_title"), _v$10 = t("interaction.answer_title");
                _v$0 !== _p$.e && (_el$10.disabled = _p$.e = _v$0);
                _v$1 !== _p$.t && setAttribute(_el$10, "title", _p$.t = _v$1);
                _v$10 !== _p$.a && setAttribute(_el$10, "aria-label", _p$.a = _v$10);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$10;
            })(), (() => {
              var _el$11 = _tmpl$6();
              _el$11.$$click = () => rejectInteraction(interaction.id);
              insert(_el$11, () => t("interaction.skip"));
              createRenderEffect((_p$) => {
                var _v$11 = busy(), _v$12 = t("interaction.skip_title"), _v$13 = t("interaction.skip_title");
                _v$11 !== _p$.e && (_el$11.disabled = _p$.e = _v$11);
                _v$12 !== _p$.t && setAttribute(_el$11, "title", _p$.t = _v$12);
                _v$13 !== _p$.a && setAttribute(_el$11, "aria-label", _p$.a = _v$13);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$11;
            })()];
          },
          get children() {
            return [(() => {
              var _el$9 = _tmpl$5();
              _el$9.$$click = () => resolveInteraction(interaction.id, "always");
              insert(_el$9, () => t("interaction.always_allow"));
              createRenderEffect((_p$) => {
                var _v$ = busy(), _v$2 = t("interaction.always_allow_title"), _v$3 = t("interaction.always_allow_title");
                _v$ !== _p$.e && (_el$9.disabled = _p$.e = _v$);
                _v$2 !== _p$.t && setAttribute(_el$9, "title", _p$.t = _v$2);
                _v$3 !== _p$.a && setAttribute(_el$9, "aria-label", _p$.a = _v$3);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$9;
            })(), (() => {
              var _el$0 = _tmpl$6();
              _el$0.$$click = () => resolveInteraction(interaction.id, "once");
              insert(_el$0, () => t("interaction.allow_once"));
              createRenderEffect((_p$) => {
                var _v$4 = busy(), _v$5 = t("interaction.allow_once_title"), _v$6 = t("interaction.allow_once_title");
                _v$4 !== _p$.e && (_el$0.disabled = _p$.e = _v$4);
                _v$5 !== _p$.t && setAttribute(_el$0, "title", _p$.t = _v$5);
                _v$6 !== _p$.a && setAttribute(_el$0, "aria-label", _p$.a = _v$6);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$0;
            })(), (() => {
              var _el$1 = _tmpl$6();
              _el$1.$$click = () => rejectInteraction(interaction.id);
              insert(_el$1, () => t("interaction.reject"));
              createRenderEffect((_p$) => {
                var _v$7 = busy(), _v$8 = t("interaction.reject_title"), _v$9 = t("interaction.reject_title");
                _v$7 !== _p$.e && (_el$1.disabled = _p$.e = _v$7);
                _v$8 !== _p$.t && setAttribute(_el$1, "title", _p$.t = _v$8);
                _v$9 !== _p$.a && setAttribute(_el$1, "aria-label", _p$.a = _v$9);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$1;
            })()];
          }
        }));
        createRenderEffect(() => setAttribute(_el$3, "data-id", interaction.id));
        return _el$3;
      })()
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return recentAutoReplies().length > 0;
      },
      get children() {
        return createComponent(For, {
          get each() {
            return recentAutoReplies();
          },
          children: (interaction) => (() => {
            var _el$12 = _tmpl$9(), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild; _el$14.nextSibling;
            insert(_el$14, () => t("interaction.auto_reply"));
            insert(_el$13, () => interaction.title, null);
            insert(_el$12, createComponent(Show, {
              get when() {
                return interaction.body;
              },
              get children() {
                var _el$16 = _tmpl$3();
                insert(_el$16, () => interaction.body);
                return _el$16;
              }
            }), null);
            insert(_el$12, createComponent(Show, {
              get when() {
                return interaction.response;
              },
              get children() {
                var _el$17 = _tmpl$8();
                insert(_el$17, () => interactionResponseSummary(interaction));
                return _el$17;
              }
            }), null);
            createRenderEffect(() => setAttribute(_el$12, "data-id", interaction.id));
            return _el$12;
          })()
        });
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => pendingInteractions().length === 0)() && recentAutoReplies().length === 0;
      },
      get children() {
        return _tmpl$();
      }
    }), null);
    return _el$;
  })();
}
delegateEvents(["click"]);

function clearBoardRetry() {
  setBoardRetryCount(0);
}
function stopTimers() {
  clearBoardRetry();
  stopSSE();
}

function record$1(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function gitCheckpointTitle(stage, mode) {
  if (stage === "baseline") {
    return mode === "created_commit" ? t("chat.git.baseline_created") : t("chat.git.baseline_recorded");
  }
  return mode === "created_commit" ? t("chat.git.result_created") : t("chat.git.result_recorded");
}
function gitCheckpointLine(key, value, options = {}) {
  if (!value) return "";
  const text = options.code ? `\`${value}\`` : String(value);
  return `- ${t(key)}: ${text}`;
}
function gitCheckpointText(item) {
  return [
    `**${gitCheckpointTitle(item.stage, item.mode)}**`,
    "",
    gitCheckpointLine("chat.git.message", item.message),
    gitCheckpointLine("chat.git.branch", item.branch, { code: true }),
    gitCheckpointLine("chat.git.commit", item.commit ? String(item.commit).slice(0, 8) : "", { code: true }),
    item.stage === "baseline" ? gitCheckpointLine("chat.git.snapshot", item.snapshot ? String(item.snapshot).slice(0, 8) : "", { code: true }) : ""
  ].filter(Boolean).join("\n");
}
function boardGitCheckpoints(board) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const meta = record$1(board?.task?.metadata) ? board.task.metadata : null;
  const git = record$1(meta?.git) ? meta.git : null;
  for (const stage of ["baseline", "result"]) {
    const item = record$1(git?.[stage]) ? git[stage] : null;
    if (!item) continue;
    const time = Number(item.time);
    if (!Number.isFinite(time)) continue;
    out.push({
      stage,
      mode: typeof item.mode === "string" ? item.mode : "recorded_head",
      branch: typeof item.branch === "string" ? item.branch : "",
      commit: typeof item.commit === "string" ? item.commit : "",
      message: typeof item.message === "string" ? item.message : "",
      snapshot: typeof item.snapshot === "string" ? item.snapshot : "",
      time
    });
    seen.add(stage);
  }
  for (const snap of Array.isArray(board?.snapshots) ? board.snapshots : []) {
    const payload = record$1(snap?.payload) ? snap.payload : null;
    const stage = typeof payload?.stage === "string" ? payload.stage : "";
    if (payload?.kind !== "git" || !stage || seen.has(stage)) continue;
    const time = Number(snap?.time?.created);
    if (!Number.isFinite(time)) continue;
    out.push({
      stage,
      mode: typeof payload.mode === "string" ? payload.mode : "recorded_head",
      branch: typeof payload.branch === "string" ? payload.branch : "",
      commit: typeof payload.commit === "string" ? payload.commit : "",
      message: typeof payload.message === "string" ? payload.message : "",
      snapshot: typeof payload.snapshot === "string" ? payload.snapshot : "",
      time
    });
  }
  return out.sort((a, b) => a.time - b.time);
}
function canInitGit() {
  return !!activeDirectory$1() && appStore.connected && boardStore.vcs !== null && !boardStore.vcs?.initialized;
}
async function initGitCurrent(options = {}) {
  const dir = activeDirectory$1();
  if (!dir || !canInitGit()) return false;
  try {
    const result = await apiJson("project/current/init-git", { method: "POST" });
    const { clearProjectScopeData } = await __vitePreload(async () => { const { clearProjectScopeData } = await Promise.resolve().then(() => workspace);return { clearProjectScopeData }},true              ?void 0:void 0);
    const { reloadProjectScope } = await __vitePreload(async () => { const { reloadProjectScope } = await Promise.resolve().then(() => config);return { reloadProjectScope }},true              ?void 0:void 0);
    clearProjectScopeData();
    await reloadProjectScope({ restoreWorkspace: false });
    if (options.notify !== false) {
      const showAppDialog = window.showAppDialog;
      if (typeof showAppDialog === "function") {
        const msg = result?.created ? t("git.init_done", { dir }) : t("git.init_exists", { dir });
        await showAppDialog({ title: t("git.init"), message: msg, kind: "info" });
      }
    }
    return true;
  } catch (e) {
    console.error("[git] Failed to initialize Git", e);
    if (options.notify !== false) {
      const showAppDialog = window.showAppDialog;
      if (typeof showAppDialog === "function") {
        await showAppDialog({ title: t("git.init"), message: String(e), kind: "error" });
      }
    }
    return false;
  }
}

const git = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  boardGitCheckpoints,
  canInitGit,
  gitCheckpointLine,
  gitCheckpointText,
  gitCheckpointTitle,
  initGitCurrent
}, Symbol.toStringTag, { value: 'Module' }));

function switchConfigTab(tabName) {
  const sidebar = document.getElementById("configSidebar");
  const content = document.getElementById("configContent");
  if (!sidebar || !content) return;
  for (const btn of sidebar.querySelectorAll(".config-nav-item")) {
    const el = btn;
    el.classList.toggle("active", el.dataset.configTab === tabName);
  }
  for (const panel of content.querySelectorAll(".config-tab-panel")) {
    const el = panel;
    el.classList.toggle("active", el.dataset.configPanel === tabName);
  }
}
function focusConfigSection(name) {
  if (!name) return;
  switchConfigTab(name);
  if (name === "channel") {
    const channelList = document.getElementById("channelList");
    channelList?.scrollTo?.({ top: 0 });
  }
}
const OVERLAY_VERSION = "0.0.1-alpha";
function escapeAboutHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderAboutVersion() {
  const grid = document.getElementById("aboutRuntimeGrid");
  if (!grid) return;
  const config = appStore.config;
  const connected = appStore.config !== null;
  const rows = [
    [t("about.rt_overlay"), "v" + OVERLAY_VERSION],
    [t("about.rt_core"), config?.version || t("about.rt_unavailable")],
    [t("about.rt_server"), settingsStore.serverUrl || "-"],
    [t("about.rt_connection"), connected ? t("about.rt_connected") : t("about.rt_disconnected")],
    [t("about.rt_directory"), settingsStore.directory || "-"],
    [t("about.rt_executor"), settingsStore.executor || "-"],
    [t("about.rt_tasks"), String(boardStore.tasks?.length || 0)]
  ];
  if (config?.platform) rows.push([t("about.platform"), config.platform]);
  if (config?.goVersion) rows.push([t("about.go_version"), config.goVersion]);
  const tauri = window.__TAURI__;
  rows.push([t("about.runtime_type"), tauri ? "Tauri Desktop" : "Browser"]);
  grid.innerHTML = rows.map(
    ([label, value]) => `<div class="about-info-label">${escapeAboutHtml(label)}</div><div class="about-info-value">${escapeAboutHtml(value)}</div>`
  ).join("");
  const chatVersion = document.getElementById("chatVersion");
  if (chatVersion) {
    const connected2 = config !== null;
    const text = connected2 ? t("version.overlay", { version: OVERLAY_VERSION }) : `${t("version.overlay", { version: OVERLAY_VERSION })} / ${t("version.core_unknown")}`;
    chatVersion.textContent = text;
    chatVersion.title = text;
  }
  renderChannelSummary();
}
function renderChannelSummary() {
  const channels = Array.isArray(appStore.channels) ? appStore.channels : [];
  const configured = channels.filter((ch) => ch.status === "configured");
  const partial = channels.filter((ch) => ch.status === "partial");
  const missing = channels.filter((ch) => ch.status === "missing");
  const disabled = channels.filter((ch) => ch.status === "disabled");
  const summary = configured.length === 0 ? t("channel.setup_needed") : configured.length === 1 ? configured[0].name : t("channel.summary_plus", { name: configured[0].name, count: configured.length - 1 });
  const details = [
    { tone: "configured", text: configured.length > 0 ? t("channel.configured", { names: configured.map((c) => c.name).join(", ") }) : t("channel.configured_none") },
    { tone: "partial", text: partial.length > 0 ? t("channel.needs_setup", { names: partial.map((c) => c.name).join(", ") }) : "" },
    { tone: "missing", text: missing.length > 0 ? t("channel.available", { names: missing.map((c) => c.name).join(", ") }) : "" },
    { tone: "disabled", text: disabled.length > 0 ? t("channel.disabled", { names: disabled.map((c) => c.name).join(", ") }) : "" }
  ].filter((d) => d.text);
  const hint = [...details.map((d) => d.text), t("channel.open_settings")].join(" | ");
  const brandVersion = document.getElementById("brandVersion");
  if (brandVersion) {
    const card = details.map((d) => `<span class="brand-channel-tip-row" data-tone="${escapeAboutHtml(d.tone)}">${escapeAboutHtml(d.text)}</span>`).join("");
    const tone = configured.length > 0 ? "brand-channel brand-channel-summary" : "brand-channel brand-channel-summary brand-channel-empty";
    brandVersion.innerHTML = [
      `<button type="button" class="brand-channel-group" data-no-drag="true" data-open-channels="true" title="${escapeAboutHtml(hint)}" aria-label="${escapeAboutHtml(hint)}">`,
      `<span class="brand-channel-label">${escapeAboutHtml(t("channel.channels"))}</span>`,
      `<span class="${tone}">${escapeAboutHtml(summary)}</span>`,
      `<span class="brand-channel-tip" aria-hidden="true">`,
      `<span class="brand-channel-tip-title">${escapeAboutHtml(t("channel.channels"))}</span>`,
      card,
      `<span class="brand-channel-tip-footer">${escapeAboutHtml(t("channel.open_settings"))}</span>`,
      `</span></button>`
    ].join("");
  }
  const configMeta = document.getElementById("configToggleMeta");
  if (configMeta) configMeta.textContent = summary;
}
function openConfigDialog(section) {
  const configDialog = document.getElementById(
    "configDialog"
  );
  if (!configDialog) return;
  if (!configDialog.open) {
    configDialog.showModal();
  }
  void loadConfigInfo().then(() => renderAboutVersion());
  if (section) {
    focusConfigSection(section);
  }
}
function installSettingsFormHandlers() {
  const form = document.getElementById("settingsForm");
  const dialog = document.getElementById("settingsDialog");
  const cancelBtn = document.getElementById("btnCancelSettings");
  if (!form || !dialog) return;
  if (form.__handlersBound) return;
  form.__handlersBound = true;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = document.getElementById("serverUrl")?.value || "";
    const password = document.getElementById("serverPassword")?.value || "";
    const username = document.getElementById("serverUsername")?.value || "opencorvus";
    setSettingsStore({ serverUrl: url, password, username });
    configure({ serverUrl: url, password, username });
    saveSettings();
    dialog.close();
    try {
      await checkConnection();
      await reloadProjectScope();
    } catch {
    }
  });
  cancelBtn?.addEventListener("click", () => {
    dialog.close();
  });
}
function setupDialogBackdropClose() {
  document.querySelectorAll("dialog.dialog").forEach((dialog) => {
    const el = dialog;
    if (el.dataset.backdropClose === "true") return;
    el.dataset.backdropClose = "true";
    el.addEventListener("click", (event) => {
      if (event.target !== el) return;
      el.close();
    });
  });
}

function record(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function providerEntry(providerID) {
  return (appStore.providerCatalog?.all ?? []).find(
    (item) => item.id === providerID
  );
}
function providerLabel(providerID) {
  return providerEntry(providerID)?.name || providerID;
}
function providerConnected(providerID) {
  return Array.isArray(appStore.providerCatalog?.connected) && appStore.providerCatalog.connected.includes(providerID);
}
function providerAuthMethods(providerID) {
  const items = Array.isArray(appStore.providerAuth?.[providerID]) ? appStore.providerAuth[providerID] : [];
  const result = [];
  let index = 0;
  for (const item of items) {
    if (record(item)) {
      const type = item.type === "oauth" ? "oauth" : "api";
      const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : type === "oauth" ? "OAuth" : "API key";
      result.push({ type, label, index });
    } else if (typeof item === "string") {
      const value = item.trim();
      if (value) {
        const type = /oauth/i.test(value) ? "oauth" : "api";
        const label = value === "api_key" ? "API key" : value;
        result.push({ type, label, index });
      }
    }
    index++;
  }
  return result;
}
function providerPreferredOauthMethod(providerID) {
  const methods = providerAuthMethods(providerID).filter(
    (m) => m.type === "oauth"
  );
  if (methods.length === 0) return null;
  return methods.find((m) => /browser/i.test(m.label)) ?? methods[0];
}
function providerState(providerID, configOverride, currentModelID) {
  const config = configOverride ?? appStore.config ?? {};
  const item = providerEntry(providerID);
  const connected = providerConnected(providerID);
  const authMethods = providerAuthMethods(providerID);
  const configKey = config?.provider?.[providerID]?.options?.apiKey;
  const key = configKey || item?.key;
  const tested = appStore.providerTest;
  if (tested?.providerID === providerID && (currentModelID === void 0 || tested?.modelID === currentModelID)) {
    return {
      tone: tested.ok ? "active" : "error",
      label: tested.ok ? t("llm.status.connected") : t("llm.status.error"),
      detail: tested.message ?? ""
    };
  }
  if (connected) {
    return {
      tone: "active",
      label: t("llm.status.connected"),
      detail: t("llm.detail.connected")
    };
  }
  if (key) {
    return {
      tone: "ready",
      label: t("llm.status.configured"),
      detail: t("llm.detail.configured")
    };
  }
  if (authMethods.length > 0) {
    return {
      tone: "warn",
      label: t("llm.status.auth_required"),
      detail: tc("llm.detail.auth_methods", authMethods.length)
    };
  }
  if ((item?.env?.length ?? 0) > 0) {
    return {
      tone: "warn",
      label: t("llm.status.needs_api_key"),
      detail: t("llm.detail.needs_api_key", { names: item.env.join(", ") })
    };
  }
  return {
    tone: "",
    label: t("llm.status.available"),
    detail: t("llm.detail.available")
  };
}
function llmSelectionKey(providerID, modelID, apiKey) {
  return JSON.stringify([providerID, modelID, apiKey]);
}
function sortedProviders(config) {
  const catalog = appStore.providerCatalog;
  const all = Array.isArray(catalog?.all) ? [...catalog.all] : [];
  const connected = catalog?.connected ?? [];
  all.sort((a, b) => {
    const ac = connected.includes(a.id) ? 0 : 1;
    const bc = connected.includes(b.id) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
  return all.map((item) => ({
    ...item,
    stateLabel: providerState(item.id, config).label
  }));
}
function modelsForProvider(providerID) {
  const catalog = appStore.providerCatalog;
  const provider = (catalog?.all ?? []).find((p) => p.id === providerID);
  return Object.keys(provider?.models ?? {}).sort(
    (a, b) => a.localeCompare(b)
  );
}
function defaultModelForProvider(providerID, config) {
  const models = modelsForProvider(providerID);
  const catalog = appStore.providerCatalog;
  if (typeof config?.model === "string" && config.model.startsWith(`${providerID}/`)) {
    const candidate = config.model.slice(providerID.length + 1);
    if (models.includes(candidate)) return candidate;
  }
  const catalogDefault = catalog?.default?.[providerID];
  if (catalogDefault && models.includes(catalogDefault)) return catalogDefault;
  return models[0] ?? "";
}
async function testProviderConnection(providerID, modelID) {
  return apiJson(`provider/${providerID}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelID })
  });
}
function providerAuthPrompt(prompt) {
  if (!record(prompt) || typeof prompt.key !== "string" || typeof prompt.message !== "string") {
    return null;
  }
  if (prompt.type === "text") {
    return {
      type: "text",
      key: prompt.key,
      message: prompt.message,
      placeholder: typeof prompt.placeholder === "string" ? prompt.placeholder : ""
    };
  }
  if (prompt.type !== "select" || !Array.isArray(prompt.options)) return null;
  const options = prompt.options.flatMap((item) => {
    if (!record(item) || typeof item.label !== "string" || typeof item.value !== "string") {
      return [];
    }
    return [
      {
        label: item.label,
        value: item.value,
        ...typeof item.hint === "string" ? { hint: item.hint } : {}
      }
    ];
  });
  if (!options.length) return null;
  return {
    type: "select",
    key: prompt.key,
    message: prompt.message,
    options
  };
}
async function providerAuthInputs(providerID, methodIndex, callbacks) {
  const inputs = {};
  const label = providerLabel(providerID);
  while (true) {
    const prompts = await apiJson(`provider/${providerID}/auth/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: methodIndex, inputs }),
      signal: AbortSignal.timeout(3e5)
    });
    const list = Array.isArray(prompts) ? prompts.map(providerAuthPrompt).filter(Boolean) : [];
    const prompt = list.find((item) => !Object.hasOwn(inputs, item.key));
    if (!prompt) return inputs;
    let value;
    if (prompt.type === "select") {
      value = await callbacks.nativeSelect(prompt.message, {
        title: label,
        selectLabel: prompt.message,
        options: prompt.options,
        okLabel: t("common.ok"),
        cancelLabel: t("common.cancel")
      });
    } else {
      value = await callbacks.nativePrompt(prompt.message, {
        title: label,
        inputLabel: prompt.message,
        inputPlaceholder: prompt.placeholder,
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel")
      });
    }
    if (value == null) return null;
    inputs[prompt.key] = String(value).trim();
  }
}
async function executeProviderAuth(providerID, methodIndex, inputs) {
  await apiJson(`provider/${providerID}/auth/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: methodIndex, inputs }),
    signal: AbortSignal.timeout(3e5)
  });
  return true;
}
async function authorizeProvider(providerID, methodIndex, callbacks) {
  const methods = providerAuthMethods(providerID);
  const explicitChoice = typeof methodIndex === "number";
  const match = explicitChoice ? methods.find((m) => m.index === methodIndex) : providerPreferredOauthMethod(providerID);
  if (!match) return false;
  if (!explicitChoice) {
    const confirmed = await callbacks.nativeConfirm(
      `${providerLabel(providerID)} ${t("llm.status.auth_required")}: ${match.label}`,
      {
        title: t("llm.title"),
        okLabel: t("common.open"),
        cancelLabel: t("common.cancel"),
        kind: "info"
      }
    );
    if (!confirmed) {
      return false;
    }
  }
  const collected = await providerAuthInputs(providerID, match.index, callbacks);
  if (collected == null) {
    return false;
  }
  const authorization = await apiJson(
    `provider/${providerID}/oauth/authorize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: match.index, inputs: collected }),
      signal: AbortSignal.timeout(3e5)
    }
  );
  if (!record(authorization) || typeof authorization.url !== "string" || typeof authorization.method !== "string") {
    throw new Error("OAuth authorization unavailable");
  }
  await callbacks.nativeOpen(authorization.url);
  if (authorization.method === "code") {
    const code = await callbacks.nativePrompt(
      [authorization.instructions, authorization.url].filter(Boolean).join("\n\n"),
      {
        title: t("llm.title"),
        inputLabel: match.label,
        inputPlaceholder: "Redirect URL or authorization code (leave blank if it auto-completes)",
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel")
      }
    );
    if (code == null) {
      return false;
    }
    await apiJson(`provider/${providerID}/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: match.index, code }),
      signal: AbortSignal.timeout(3e5)
    });
    return true;
  }
  callbacks.showLlmNotice(
    authorization.instructions || authorization.url,
    "warn",
    0
  );
  await apiJson(`provider/${providerID}/oauth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: match.index }),
    signal: AbortSignal.timeout(3e5)
  });
  return true;
}
async function runProviderAuthMethod(providerID, method, callbacks) {
  if (method.type === "oauth") {
    return authorizeProvider(providerID, method.index, callbacks);
  }
  const inputs = await providerAuthInputs(providerID, method.index, callbacks);
  if (inputs == null) return false;
  if (Object.keys(inputs).length === 0) {
    return "input";
  }
  await executeProviderAuth(providerID, method.index, inputs);
  return true;
}
async function authenticateSelectedProvider(providerID, callbacks) {
  const methods = providerAuthMethods(providerID);
  if (!providerID || methods.length === 0) return false;
  if (methods.length === 1 && methods[0]) {
    const result2 = await runProviderAuthMethod(
      providerID,
      methods[0],
      callbacks
    );
    return result2 === true;
  }
  const value = await callbacks.nativeSelect(t("llm.auth_choose_method"), {
    title: providerLabel(providerID),
    selectLabel: t("llm.auth_method"),
    options: methods.map((m) => ({
      label: m.label,
      value: String(m.index),
      hint: m.type === "oauth" ? t("llm.auth_type_oauth") : t("llm.auth_type_api")
    }))
  });
  if (value == null) return false;
  const method = methods.find((m) => String(m.index) === value);
  if (!method) return false;
  const result = await runProviderAuthMethod(providerID, method, callbacks);
  return result === true;
}

const HIDE_EYE_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.1 2.1l11.8 11.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 6.3A2.8 2.8 0 019.7 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2 2.4 0 4.6 1.4 6.3 4.2-.5.9-1 1.6-1.6 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SHOW_EYE_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2s4.7 1.4 6.3 4.2c-1.6 2.8-3.8 4.2-6.3 4.2S3.3 10.8 1.7 8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/></svg>';
const COPY_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="4.2" width="7.1" height="8.1" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 10.6H3.7A1.5 1.5 0 012.2 9.1V3.7a1.5 1.5 0 011.5-1.5h5.4a1.5 1.5 0 011.5 1.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const elements = {
  form: null,
  provider: null,
  model: null,
  apiKey: null,
  apiKeySummary: null,
  apiKeyToggle: null,
  apiKeyCopy: null,
  authAction: null,
  status: null,
  summary: null,
  notice: null,
  available: null
};
let installed = false;
let apiKeyVisible = false;
let llmFormDirty = false;
let llmSavedValue = "";
let llmSaveTimer;
let llmSyncSerial = 0;
let llmNoticeTimer;
async function waitForDialogTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function authCallbacks() {
  return {
    nativePrompt: async (...args) => {
      await waitForDialogTurn();
      return nativePrompt(...args);
    },
    nativeSelect: async (...args) => {
      await waitForDialogTurn();
      return nativeSelect(...args);
    },
    nativeConfirm: async (...args) => {
      await waitForDialogTurn();
      return nativeConfirm(...args);
    },
    nativeOpen,
    showLlmNotice
  };
}
async function hasInitialOauthPrompts(providerID, methodIndex) {
  const prompts = await apiJson(`provider/${providerID}/auth/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: methodIndex, inputs: {} }),
    signal: AbortSignal.timeout(3e5)
  });
  const parsed = Array.isArray(prompts) ? prompts.map(providerAuthPrompt).filter(Boolean) : [];
  return parsed.length > 0;
}
function bindElements() {
  elements.form = document.getElementById("llmForm");
  elements.provider = document.getElementById("llmProvider");
  elements.model = document.getElementById("llmModel");
  elements.apiKey = document.getElementById("llmApiKey");
  elements.apiKeySummary = document.getElementById("llmApiKeySummary");
  elements.apiKeyToggle = document.getElementById("btnLlmApiKeyToggle");
  elements.apiKeyCopy = document.getElementById("btnLlmApiKeyCopy");
  elements.authAction = document.getElementById("btnLlmAuthAction");
  elements.status = document.getElementById("llmStatus");
  elements.summary = document.getElementById("llmSummary");
  elements.notice = document.getElementById("llmNotice");
  elements.available = document.getElementById("cfgAvailableProviders");
}
function currentSelection() {
  return {
    providerID: elements.provider?.value?.trim() || "",
    modelID: elements.model?.value?.trim() || "",
    apiKey: elements.apiKey?.value ?? ""
  };
}
function clearProviderAuthDismissed(providerID) {
  const next = { ...appStore.providerAuthDismissed || {} };
  delete next[providerID];
  setAppStore("providerAuthDismissed", next);
}
function renderLlmSummary() {
  if (!elements.summary) return;
  const { providerID, modelID } = currentSelection();
  if (!providerID || !modelID) {
    const text2 = t("llm.summary_empty");
    elements.summary.textContent = text2;
    elements.summary.title = text2;
    return;
  }
  const text = t("llm.summary_value", {
    provider: providerLabel(providerID),
    model: modelID
  });
  elements.summary.textContent = text;
  elements.summary.title = text;
}
function renderAvailableProviders() {
  if (!elements.available) return;
  const total = Array.isArray(appStore.providerCatalog?.all) ? appStore.providerCatalog.all.length : 0;
  const connected = Array.isArray(appStore.providerCatalog?.connected) ? appStore.providerCatalog.connected.length : 0;
  const text = total === 0 ? t("llm.available_count_zero") : `${connected}/${total}`;
  elements.available.textContent = text;
  elements.available.title = text;
  elements.available.dataset.status = connected > 0 ? "active" : total > 0 ? "ready" : "";
}
function renderLlmApiKeyTools() {
  if (elements.apiKey) {
    elements.apiKey.type = apiKeyVisible ? "text" : "password";
  }
  if (elements.apiKeyToggle) {
    elements.apiKeyToggle.innerHTML = apiKeyVisible ? HIDE_EYE_SVG : SHOW_EYE_SVG;
    const title = t(apiKeyVisible ? "llm.api_key_hide" : "llm.api_key_show");
    elements.apiKeyToggle.title = title;
    elements.apiKeyToggle.setAttribute("aria-label", title);
  }
  if (elements.apiKeyCopy) {
    elements.apiKeyCopy.innerHTML = COPY_SVG;
    const title = t("llm.api_key_copy");
    elements.apiKeyCopy.title = title;
    elements.apiKeyCopy.setAttribute("aria-label", title);
    elements.apiKeyCopy.disabled = !!elements.apiKey?.disabled || !elements.apiKey?.value?.trim();
  }
  if (elements.apiKeySummary) {
    const value = elements.apiKey?.value?.trim() || "";
    elements.apiKeySummary.textContent = value ? t("llm.status.configured") : "";
    elements.apiKeySummary.dataset.tone = value ? "good" : "";
  }
}
function renderLlmAuthAction(providerID) {
  if (!elements.authAction) return;
  const visible = providerAuthMethods(providerID).length > 0;
  elements.authAction.classList.toggle("hidden", !visible);
  elements.authAction.disabled = !visible || !!elements.provider?.disabled;
  if (!visible) return;
  elements.authAction.textContent = t("llm.auth_connect");
  elements.authAction.title = t("llm.auth_connect_title");
  elements.authAction.setAttribute("aria-label", t("llm.auth_connect_title"));
}
function renderInlineProviderStatus(providerID, configOverride) {
  if (!elements.status) return;
  const resolvedProviderID = providerID || elements.provider?.value?.trim() || "";
  const modelID = elements.model?.value?.trim() || "";
  if (!resolvedProviderID) {
    elements.status.textContent = t("llm.status.unknown");
    elements.status.dataset.status = "";
    elements.status.title = "";
    renderLlmAuthAction("");
    renderLlmSummary();
    return;
  }
  const info = providerState(resolvedProviderID, configOverride ?? appStore.config, modelID);
  elements.status.textContent = info.label;
  elements.status.dataset.status = info.tone;
  elements.status.title = info.detail || info.label;
  renderLlmAuthAction(resolvedProviderID);
  renderLlmSummary();
}
function setLlmBusy(value) {
  const busy = !!value;
  if (elements.provider) elements.provider.disabled = busy;
  if (elements.model) elements.model.disabled = busy;
  if (elements.apiKey) elements.apiKey.disabled = busy;
  if (elements.apiKeyToggle) elements.apiKeyToggle.disabled = busy;
  if (elements.apiKeyCopy) elements.apiKeyCopy.disabled = busy || !elements.apiKey?.value?.trim();
  renderLlmAuthAction(elements.provider?.value || "");
  renderLlmApiKeyTools();
}
function showLlmNotice(message, tone = "", duration = 2600) {
  if (!elements.notice) return;
  if (llmNoticeTimer) clearTimeout(llmNoticeTimer);
  elements.notice.textContent = message || "";
  elements.notice.dataset.status = tone;
  elements.notice.dataset.open = message ? "true" : "false";
  if (!message || duration <= 0) return;
  llmNoticeTimer = setTimeout(() => {
    if (!elements.notice) return;
    elements.notice.dataset.open = "false";
  }, duration);
}
function populateModelSelect(syncSaved = false, providerChanged = false) {
  if (!elements.provider || !elements.model) return;
  const providerID = elements.provider.value.trim();
  const models = modelsForProvider(providerID);
  const previousModel = elements.model.value;
  elements.model.innerHTML = models.map((item) => `<option value="${item}">${item}</option>`).join("");
  if (llmFormDirty && !providerChanged) {
    elements.model.value = models.includes(previousModel) ? previousModel : models[0] || "";
  } else {
    const current = defaultModelForProvider(providerID, appStore.config);
    elements.model.value = models.includes(current) ? current : models[0] || "";
  }
  if (!llmFormDirty || providerChanged) {
    if (elements.apiKey) {
      elements.apiKey.value = appStore.config?.provider?.[providerID]?.options?.apiKey || "";
    }
  }
  if (syncSaved) {
    const current = currentSelection();
    llmSavedValue = llmSelectionKey(current.providerID, current.modelID, current.apiKey);
  }
  renderInlineProviderStatus(providerID, appStore.config);
  renderLlmApiKeyTools();
}
function populateProviderSelect(syncSaved = false) {
  if (!elements.provider) return;
  const providers = sortedProviders(appStore.config);
  const previousProvider = elements.provider.value;
  const currentModel = typeof appStore.config?.model === "string" ? appStore.config.model : "";
  const currentProvider = currentModel && currentModel.includes("/") ? currentModel.split("/")[0] : "";
  elements.provider.innerHTML = providers.map((item) => `<option value="${item.id}">${providerLabel(item.id)} · ${item.stateLabel}</option>`).join("");
  if (llmFormDirty) {
    elements.provider.value = providers.some((item) => item.id === previousProvider) ? previousProvider : providers[0]?.id || "";
  } else {
    const fallback = currentProvider || providers[0]?.id || "";
    elements.provider.value = providers.some((item) => item.id === fallback) ? fallback : providers[0]?.id || "";
  }
  populateModelSelect(syncSaved, false);
}
async function syncLlmSettings() {
  const current = currentSelection();
  const nextValue = llmSelectionKey(current.providerID, current.modelID, current.apiKey);
  if (nextValue === llmSavedValue) return;
  if (!current.providerID || !current.modelID) return;
  const serial = ++llmSyncSerial;
  setProviderTest(null);
  setLlmBusy(true);
  if (elements.status) {
    elements.status.textContent = t("llm.status.saving");
    elements.status.dataset.status = "warn";
    elements.status.title = `${current.providerID}/${current.modelID}`;
  }
  showLlmNotice(
    t("llm.notice.saving", {
      provider: current.providerID,
      model: current.modelID
    }),
    "warn",
    0
  );
  try {
    const saved = await updateConfig((config) => {
      config.model = `${current.providerID}/${current.modelID}`;
      config.provider = config.provider || {};
      const entry = config.provider[current.providerID] || {};
      entry.options = entry.options || {};
      if (current.apiKey.trim()) entry.options.apiKey = current.apiKey.trim();
      if (!current.apiKey.trim()) delete entry.options.apiKey;
      if (Object.keys(entry.options).length === 0) delete entry.options;
      if (Object.keys(entry).length > 0) config.provider[current.providerID] = entry;
      if (Object.keys(entry).length === 0) delete config.provider[current.providerID];
      if (Object.keys(config.provider).length === 0) delete config.provider;
    });
    if (serial !== llmSyncSerial) return;
    setAppStore("config", saved ?? null);
    llmSavedValue = nextValue;
    const connected = Array.isArray(appStore.providerCatalog?.connected) && appStore.providerCatalog.connected.includes(current.providerID);
    const needsAuth = !connected && providerAuthMethods(current.providerID).length > 0;
    if (needsAuth) {
      const oauthMethod = providerPreferredOauthMethod(current.providerID);
      if (!oauthMethod) {
        renderInlineProviderStatus(current.providerID, appStore.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
      if (await hasInitialOauthPrompts(current.providerID, oauthMethod.index)) {
        renderInlineProviderStatus(current.providerID, appStore.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
      const ready = await authorizeProvider(current.providerID, void 0, authCallbacks());
      if (serial !== llmSyncSerial) return;
      await loadConfigInfo();
      if (serial !== llmSyncSerial) return;
      if (!ready) {
        dismissProviderAuth(current.providerID);
        renderInlineProviderStatus(current.providerID, appStore.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
      clearProviderAuthDismissed(current.providerID);
    }
    const result = await testProviderConnection(current.providerID, current.modelID);
    if (serial !== llmSyncSerial) return;
    setProviderTest({
      providerID: current.providerID,
      modelID: current.modelID,
      ok: !!result?.ok,
      message: result?.message || (result?.ok ? t("llm.status.connected") : t("llm.notice.test_failed"))
    });
    llmFormDirty = false;
    renderInlineProviderStatus(current.providerID, appStore.config);
    showLlmNotice(
      appStore.providerTest?.message || "",
      appStore.providerTest?.ok ? "active" : "error"
    );
  } catch (error) {
    if (serial !== llmSyncSerial) return;
    const message = error instanceof Error ? error.message : String(error || "");
    setProviderTest({
      providerID: current.providerID,
      modelID: current.modelID,
      ok: false,
      message: message || t("llm.notice.update_failed")
    });
    renderInlineProviderStatus(current.providerID, appStore.config);
    showLlmNotice(appStore.providerTest?.message || "", "error", 3200);
  } finally {
    if (serial === llmSyncSerial) setLlmBusy(false);
  }
}
function queueLlmSync(delay = 220) {
  setProviderTest(null);
  renderInlineProviderStatus(elements.provider?.value || "", appStore.config);
  if (llmSaveTimer) clearTimeout(llmSaveTimer);
  llmSaveTimer = setTimeout(() => {
    llmSaveTimer = void 0;
    void syncLlmSettings();
  }, delay);
}
async function scheduleProviderSelectionSync() {
  const providerID = elements.provider?.value?.trim() || "";
  setProviderTest(null);
  renderInlineProviderStatus(providerID, appStore.config);
  if (!providerID) return;
  const connected = Array.isArray(appStore.providerCatalog?.connected) && appStore.providerCatalog.connected.includes(providerID);
  const methods = providerAuthMethods(providerID);
  if (!connected && methods.length > 0) {
    const oauthMethod = providerPreferredOauthMethod(providerID);
    if (!oauthMethod) return;
    const currentProviderID = providerID;
    if (await hasInitialOauthPrompts(providerID, oauthMethod.index)) {
      if ((elements.provider?.value?.trim() || "") !== currentProviderID) return;
      return;
    }
    if ((elements.provider?.value?.trim() || "") !== currentProviderID) return;
  }
  queueLlmSync(180);
}
async function copyApiKey() {
  const value = elements.apiKey?.value?.trim() || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showLlmNotice(t("llm.api_key_copy_done"), "active", 1800);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    showLlmNotice(message || t("common.error"), "error", 3200);
  }
}
function refreshInlineLlmConfig(syncSaved = !llmFormDirty) {
  bindElements();
  if (!elements.provider || !elements.model || !elements.apiKey) return;
  populateProviderSelect(syncSaved);
  renderAvailableProviders();
  renderInlineProviderStatus(elements.provider.value, appStore.config);
}
function installInlineLlmConfig() {
  if (installed) return;
  bindElements();
  if (!elements.provider || !elements.model || !elements.apiKey) return;
  installed = true;
  elements.form?.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  elements.provider.addEventListener("change", () => {
    llmFormDirty = true;
    clearProviderAuthDismissed(elements.provider?.value || "");
    populateModelSelect(false, true);
    renderLlmSummary();
    void scheduleProviderSelectionSync();
  });
  elements.model.addEventListener("change", () => {
    llmFormDirty = true;
    renderLlmSummary();
    queueLlmSync(180);
  });
  elements.apiKey.addEventListener("input", () => {
    llmFormDirty = true;
    renderLlmApiKeyTools();
    queueLlmSync(220);
  });
  elements.apiKeyToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    apiKeyVisible = !apiKeyVisible;
    renderLlmApiKeyTools();
  });
  elements.apiKeyCopy?.addEventListener("click", (event) => {
    event.preventDefault();
    void copyApiKey();
  });
  elements.authAction?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (llmSaveTimer) {
      clearTimeout(llmSaveTimer);
      llmSaveTimer = void 0;
    }
    try {
      const providerID = elements.provider?.value?.trim() || "";
      const authenticated = await authenticateSelectedProvider(providerID, authCallbacks());
      if (authenticated !== true) {
        if (providerID) dismissProviderAuth(providerID);
        return;
      }
      if (providerID) clearProviderAuthDismissed(providerID);
      await loadConfigInfo();
      llmSavedValue = "";
      queueLlmSync(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      showLlmNotice(message, "error", 3200);
      const nativeMessage = window.nativeMessage;
      if (typeof nativeMessage === "function") {
        await nativeMessage(message, {
          title: t("llm.title"),
          kind: "error"
        });
      }
    }
  });
  refreshInlineLlmConfig(true);
}

function syncExecutorWidth() {
  const bar = document.getElementById("engineBar");
  if (!bar) return;
  bar.style.removeProperty("--engine-chip-width");
  requestAnimationFrame(() => {
    const buttons = [...bar.querySelectorAll("[data-executor]")];
    const width = buttons.reduce(
      (max, btn) => Math.max(max, Math.ceil(btn.getBoundingClientRect().width)),
      0
    );
    if (width > 0) {
      bar.style.setProperty("--engine-chip-width", `${width}px`);
    }
  });
}

const [logOpen, setLogOpen] = createSignal(false);
const [workspaceOpen, setWorkspaceOpen] = createSignal(false);
const [workspaceView, setWorkspaceView] = createSignal({
  kind: "build"
});
const [composerTarget, setComposerTarget] = createSignal("task");
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function openWorkspace(view) {
  if (view) setWorkspaceView(view);
  setWorkspaceOpen(true);
  const next = view ?? workspaceView();
  setComposerTarget(next.kind === "build" ? "build" : "task");
}
function closeWorkspace() {
  setWorkspaceOpen(false);
  setComposerTarget("task");
}
function toggleWorkspace() {
  if (workspaceOpen()) closeWorkspace();
  else openWorkspace();
}
function setWorkspaceViewAndFocus(view) {
  setWorkspaceView(view);
  setComposerTarget(view.kind === "build" ? "build" : "task");
}
function openWorkspaceDiff(filePath) {
  openWorkspace({
    kind: "diff",
    filePath
  });
}
function openWorkspaceFile(filePath) {
  openWorkspace({
    kind: "file",
    filePath
  });
}
window.openWorkspaceDiff = openWorkspaceDiff;
window.openWorkspaceFile = openWorkspaceFile;
document.addEventListener("click", (ev) => {
  const target = ev.target;
  if (!target) return;
  const link = target.closest("[data-file-path]");
  if (!link) return;
  const path = link.getAttribute("data-file-path");
  if (!path) return;
  ev.preventDefault();
  openWorkspaceFile(path);
});
function installAppDialogBridge() {
  const dialog = document.getElementById("appDialog");
  const titleEl = document.getElementById("appDialogTitle");
  const bodyEl = document.getElementById("appDialogBody");
  const inputField = document.getElementById("appDialogInputField");
  const inputLabel = document.getElementById("appDialogInputLabel");
  const inputEl = document.getElementById("appDialogInput");
  const selectField = document.getElementById("appDialogSelectField");
  const selectLabel = document.getElementById("appDialogSelectLabel");
  const selectEl = document.getElementById("appDialogSelect");
  const okBtn = document.getElementById("btnAppDialogOk");
  const cancelBtn = document.getElementById("btnAppDialogCancel");
  if (!dialog || !titleEl || !bodyEl || !okBtn || !cancelBtn) return;
  if (dialog.dataset.bridgeBound === "true") return;
  dialog.dataset.bridgeBound = "true";
  let resolver = null;
  let restoreConfigDialog = false;
  const settle = (confirmed) => {
    const resolve = resolver;
    resolver = null;
    const value = inputField?.classList.contains("hidden") ? selectField?.classList.contains("hidden") ? null : selectEl?.value ?? null : inputEl?.value ?? null;
    dialog.close();
    resolve?.({
      confirmed,
      value
    });
  };
  cancelBtn.addEventListener("click", () => settle(false));
  okBtn.addEventListener("click", () => settle(true));
  dialog.addEventListener("close", () => {
    const shouldRestoreConfigDialog = restoreConfigDialog;
    restoreConfigDialog = false;
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve({
        confirmed: false,
        value: null
      });
    }
    if (shouldRestoreConfigDialog) {
      queueMicrotask(() => openConfigDialog());
    }
  });
  const showAppDialog = (options = {}) => {
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve({
        confirmed: false,
        value: null
      });
    }
    const configDialog = document.getElementById("configDialog");
    restoreConfigDialog = configDialog?.open === true;
    if (restoreConfigDialog) {
      configDialog?.close();
    }
    titleEl.textContent = options.title || t("dialog.notice");
    bodyEl.textContent = options.message || "";
    okBtn.textContent = options.okLabel || t("common.ok");
    cancelBtn.textContent = options.cancelLabel || t("common.cancel");
    cancelBtn.hidden = options.cancel !== true;
    if (inputField && inputEl && inputLabel) {
      inputField.classList.toggle("hidden", options.input !== true);
      inputLabel.textContent = options.inputLabel || t("dialog.input");
      inputEl.placeholder = options.inputPlaceholder || "";
      inputEl.value = options.inputValue || "";
    }
    if (selectField && selectEl && selectLabel) {
      selectField.classList.toggle("hidden", options.select !== true);
      selectLabel.textContent = options.selectLabel || t("dialog.input");
      selectEl.innerHTML = "";
      for (const item of options.selectOptions || []) {
        if (!item?.value) continue;
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label || item.value;
        option.selected = item.value === (options.selectValue || "");
        selectEl.appendChild(option);
      }
      if (!selectEl.value && selectEl.options.length > 0) {
        selectEl.value = options.selectValue || selectEl.options[0].value;
      }
    }
    dialog.showModal();
    if (options.input && inputEl) {
      queueMicrotask(() => inputEl.focus());
    } else {
      queueMicrotask(() => okBtn.focus());
    }
    return new Promise((resolve) => {
      resolver = resolve;
    });
  };
  window.showAppDialog = showAppDialog;
  window.nativeMessage = async (message, options = {}) => showAppDialog({
    title: options.title,
    message,
    kind: options.kind,
    okLabel: options.okLabel
  });
}
function installGlobalBridges() {
  installAppDialogBridge();
  window.createOverlayInteractions = createOverlayInteractions;
  window.renderMarkdown = renderMarkdown;
  window.persistOverlaySettings = async () => {
    saveSettings();
  };
  window.stepZoom = (delta) => {
    const next = sanitizeZoom((settingsStore.zoom || 1) + delta);
    setSettingsStore("zoom", next);
    applyZoom(next);
    saveSettings();
  };
  const testStateTarget = {};
  const readState = (prop) => {
    if (typeof prop !== "string") return Reflect.get(testStateTarget, prop);
    if (prop === "directory") return activeDirectory();
    if (prop === "board") return boardStore.board;
    if (prop === "tasks") return boardStore.tasks;
    if (prop === "pendingTasks") return boardStore.pendingTasks;
    if (prop === "selectedTaskID") return boardStore.selectedTaskID;
    if (prop === "path") return boardStore.path;
    if (prop === "vcs") return boardStore.vcs;
    if (prop === "changes") return boardStore.changes;
    if (prop === "messages") return store.messages;
    if (prop === "agentEvents") return store.agentEvents;
    if (prop === "sseConnected") return store.sseConnected;
    if (prop in appStore) return appStore[prop];
    if (prop === "settings") return settingsStore;
    if (prop in settingsStore) return settingsStore[prop];
    return Reflect.get(testStateTarget, prop);
  };
  const writeState = (prop, value) => {
    if (typeof prop !== "string") return Reflect.set(testStateTarget, prop, value);
    if (prop === "directory") {
      setSettingsStore("directory", typeof value === "string" ? value : "");
      return true;
    }
    if (prop === "board") {
      setBoardStore("board", value);
      return true;
    }
    if (prop === "tasks") {
      setBoardStore("tasks", Array.isArray(value) ? value : []);
      return true;
    }
    if (prop === "pendingTasks") {
      setBoardStore("pendingTasks", Array.isArray(value) ? value : []);
      return true;
    }
    if (prop === "selectedTaskID") {
      const next = typeof value === "string" ? value : "";
      setBoardStore("selectedTaskID", next);
      setSelectedTaskID(next);
      return true;
    }
    if (prop === "path") {
      setBoardStore("path", value);
      return true;
    }
    if (prop === "vcs") {
      setBoardStore("vcs", value);
      return true;
    }
    if (prop === "changes") {
      setBoardStore("changes", Array.isArray(value) ? value : []);
      return true;
    }
    if (prop === "messages") {
      setMessages(Array.isArray(value) ? value : []);
      return true;
    }
    if (prop === "agentEvents") {
      setAgentEvents(Array.isArray(value) ? value : []);
      return true;
    }
    if (prop === "sseConnected") {
      setSseConnected(value === true);
      return true;
    }
    if (prop in appStore) {
      setAppStore(prop, value);
      return true;
    }
    if (prop in settingsStore) {
      setSettingsStore(prop, value);
      return true;
    }
    return Reflect.set(testStateTarget, prop, value);
  };
  window.state = new Proxy(testStateTarget, {
    get(_target, prop) {
      return readState(prop);
    },
    set(_target, prop, value) {
      return writeState(prop, value);
    },
    ownKeys() {
      return Array.from(/* @__PURE__ */ new Set([...Reflect.ownKeys(testStateTarget), ...Object.keys(boardStore), ...Object.keys(store), ...Object.keys(appStore), ...Object.keys(settingsStore), "directory", "settings"]));
    },
    getOwnPropertyDescriptor(_target, prop) {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: readState(prop)
      };
    }
  });
  window.renderConversation = () => conversationMessages();
  window.applyDirectory = applyDirectory;
  window.loadTasks = loadTasks;
  window.selectTask = selectTask;
  window.loadBoard = loadBoard;
  window.loadConversation = loadConversation;
}
function installGoalFormHandlers() {
  const form = document.getElementById("goalForm");
  const dialog = document.getElementById("goalDialog");
  const cancelBtn = document.getElementById("btnCancelGoal");
  if (!form || !dialog) return;
  if (form.__goalBound) return;
  form.__goalBound = true;
  cancelBtn?.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!boardStore.selectedTaskID) return;
    const goalID = document.getElementById("goalId")?.value.trim() || "";
    const title = document.getElementById("goalDescription")?.value.trim() || "";
    const doneDefinition = document.getElementById("goalCriteria")?.value.trim() || "";
    if (!title) return;
    try {
      if (goalID) {
        await panelMessage(`Update goal ${goalID}.`, {
          goalID,
          title,
          done_definition: doneDefinition || "The requested change is implemented and acceptance checks pass.",
          taskID: boardStore.selectedTaskID || void 0
        });
      } else {
        const payload = doneDefinition ? `/goal ${title}
Criteria: ${doneDefinition}` : `/goal ${title}`;
        await panelMessage(payload, {
          taskID: boardStore.selectedTaskID || void 0
        });
      }
      dialog.close();
      await loadBoard({
        sync: true
      });
    } catch (err) {
      console.error("Failed to save goal", err);
    }
  });
}
installGlobalBridges();
installBudgetBindings();
installInlineLlmConfig();
setupDialogBackdropClose();
installSettingsFormHandlers();
installGoalFormHandlers();
const chatScroll = document.getElementById("chatScroll");
if (chatScroll) {
  chatScroll.innerHTML = "";
  render(() => createComponent(Conversation, {
    container: chatScroll
  }), chatScroll);
}
let codingAPI = null;
const workspaceMountEl = document.getElementById("solidWorkspaceMount");
if (workspaceMountEl) {
  workspaceMountEl.innerHTML = "";
  render(() => createComponent(WorkspacePanel, {
    get view() {
      return workspaceView();
    },
    onSelectView: setWorkspaceViewAndFocus,
    onClose: closeWorkspace,
    onCodingReady: (api) => {
      codingAPI = api;
    }
  }), workspaceMountEl);
}
const taskListEl = document.getElementById("taskListPanel");
if (taskListEl) {
  taskListEl.innerHTML = "";
  render(() => createComponent(TaskList, {
    onSelectTask: (taskID) => void selectTask(taskID),
    onDeleteTask: (taskID) => {
      void deleteTask(taskID);
    }
  }), taskListEl);
}
const boardEl = document.getElementById("solidBoardMount");
if (boardEl) {
  boardEl.innerHTML = "";
  render(() => createComponent(Board, {
    onRetry: async () => {
      const id = boardStore.selectedTaskID;
      if (!id) return;
      void retryTask(id);
    },
    onReplan: () => {
      const id = boardStore.selectedTaskID;
      if (id) void replanTask(id);
    },
    onCancel: () => {
      const id = boardStore.selectedTaskID;
      if (id) void cancelTask(id);
    },
    onEditGoal: (goalId, title, detail) => {
      const goalDialog = document.getElementById("goalDialog");
      const goalIdInput = document.getElementById("goalId");
      const goalDesc = document.getElementById("goalDescription");
      const goalCrit = document.getElementById("goalCriteria");
      if (!goalDialog || !goalIdInput || !goalDesc || !goalCrit) return;
      goalIdInput.value = goalId || "";
      goalDesc.value = title || "";
      goalCrit.value = detail || "";
      goalDialog.showModal();
    },
    onOpenSession: async (sessionID, goalTitle) => {
      const dialog = document.getElementById("sessionDialog");
      const titleEl = document.getElementById("sessionDialogTitle");
      const bodyEl = document.getElementById("sessionDialogBody");
      if (!dialog || !titleEl || !bodyEl) return;
      titleEl.textContent = goalTitle || "Executor Session";
      bodyEl.innerHTML = '<p class="empty-hint">Loading…</p>';
      dialog.showModal();
      try {
        const messages = await apiJson(`session/${sessionID}/message`);
        if (!messages || messages.length === 0) {
          bodyEl.innerHTML = '<p class="empty-hint">No messages yet.</p>';
          return;
        }
        const html = messages.map((msg) => {
          const role = msg.info?.role ?? msg.role ?? "unknown";
          const parts = Array.isArray(msg.parts) ? msg.parts : [];
          const textParts = parts.filter((p) => p.type === "text" && p.text && p.audience?.ui !== false).map((p) => `<div class="session-msg-text md-content">${renderMarkdown(p.text)}</div>`).join("");
          const toolParts = parts.filter((p) => p.type === "tool-invocation" || p.type === "tool-call").map((p) => {
            const name = p.toolName ?? p.tool ?? "tool";
            return `<p class="session-msg-tool">⚙ ${escapeHtml(name)}</p>`;
          }).join("");
          if (!textParts && !toolParts) return "";
          return `<div class="session-msg" data-role="${escapeHtml(role)}">
                <span class="session-msg-role">${escapeHtml(role)}</span>
                ${textParts}${toolParts}
              </div>`;
        }).filter(Boolean).join("");
        bodyEl.innerHTML = html || '<p class="empty-hint">No displayable messages.</p>';
      } catch (e) {
        bodyEl.innerHTML = `<p class="empty-hint">Failed to load session: ${escapeHtml(String(e))}</p>`;
      }
    },
    onDeleteGoal: async (goalId) => {
      if (!goalId || !boardStore.selectedTaskID) return;
      const nativeConfirm = window.nativeConfirm;
      if (typeof nativeConfirm === "function") {
        const ok = await nativeConfirm(t("goal.delete_button_title"), {
          title: t("goal.title"),
          okLabel: t("common.delete"),
          kind: "warning"
        });
        if (!ok) return;
      }
      try {
        await panelMessage(`Delete goal ${goalId}.`, {
          goalID: goalId,
          taskID: boardStore.selectedTaskID || void 0
        });
        await loadBoard({
          sync: true
        });
      } catch (e) {
        console.error("Failed to delete goal", e);
      }
    },
    onResolveInteraction: async (id, action) => {
      try {
        await apiJson(`interaction/${id}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            reply: action
          }),
          signal: AbortSignal.timeout(3e4)
        });
      } catch (err) {
        console.error("[main] resolveInteraction failed", err);
      } finally {
        await loadBoard();
      }
    },
    onRejectInteraction: async (id) => {
      try {
        await apiJson(`interaction/${id}/reject`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(3e4)
        });
      } catch (err) {
        console.error("[main] rejectInteraction failed", err);
      } finally {
        await loadBoard();
      }
    }
  }), boardEl);
}
const composerEl = document.getElementById("solidChatComposer");
if (composerEl) {
  const isBuildTarget = () => composerTarget() === "build";
  render(() => createComponent(ChatComposer, {
    get enabled() {
      return memo(() => !!isBuildTarget())() ? true : canComposeChat();
    },
    get busy() {
      return memo(() => !!isBuildTarget())() ? codingAPI?.busy() ?? false : !!store.chatRequest || isTaskInterruptable();
    },
    get stopping() {
      return memo(() => !!isBuildTarget())() ? false : !!store.chatRequest?.stopping;
    },
    onSubmit: (text, attachments, webSearch) => {
      if (isBuildTarget() && codingAPI) {
        codingAPI.send(text);
      } else {
        void panelMessage(text, attachments, webSearch ? {
          web_search: true
        } : {});
      }
    },
    onStop: () => {
      if (isBuildTarget() && codingAPI) {
        codingAPI.stop();
      } else {
        if (store.chatRequest) {
          void stopChatRequest({
            remote: false
          });
        }
        const id = boardStore.selectedTaskID;
        if (id) {
          void interruptTask(id);
        } else {
          void stopChatRequest();
        }
      }
    }
  }), composerEl);
}
const btnTerminateRun = document.getElementById("btnTerminateRun");
if (btnTerminateRun) {
  btnTerminateRun.addEventListener("click", () => {
    if (store.chatRequest) {
      void stopChatRequest();
      return;
    }
    const taskID = boardStore.selectedTaskID;
    if (taskID) void cancelTask(taskID);
  });
}
const windowControlsEl = document.getElementById("solidWindowControls");
if (windowControlsEl) {
  render(() => createComponent(WindowControls, {}), windowControlsEl);
}
const titlebarMenuEl = document.getElementById("solidTitlebarMenu");
if (titlebarMenuEl) {
  render(() => createComponent(TitlebarMenu, {
    onLocaleChange: (locale) => {
      setSettingsStore("locale", locale);
      saveSettings();
    },
    onOpenLog: () => setLogOpen(true),
    onOpenSettings: () => {
      openConfigDialog();
    }
  }), titlebarMenuEl);
}
const connBadgeEl = document.getElementById("solidConnBadge");
if (connBadgeEl) {
  render(() => createComponent(ConnectionBadge, {}), connBadgeEl);
}
const changesPanelEl = document.getElementById("solidChangesPanel");
if (changesPanelEl) {
  render(() => createComponent(ChangesPanel, {
    get hasSelectedTask() {
      return !!boardStore.selectedTaskID;
    }
  }), changesPanelEl);
}
const logViewerEl = document.getElementById("solidLogViewer");
if (logViewerEl) {
  render(() => createComponent(LogViewer, {
    get open() {
      return logOpen();
    },
    onClose: () => setLogOpen(false)
  }), logViewerEl);
}
const promptBody = document.getElementById("promptBody");
if (promptBody) {
  promptBody.innerHTML = "";
  render(() => createComponent(PromptCatalog, {}), promptBody);
}
const generalBody = document.getElementById("generalBody");
if (generalBody) {
  generalBody.innerHTML = "";
  render(() => createComponent(GeneralPanel, {}), generalBody);
}
const orchestrationBody = document.getElementById("orchestrationBody");
if (orchestrationBody) {
  orchestrationBody.innerHTML = "";
  render(() => createComponent(OrchestrationPanel, {}), orchestrationBody);
}
const permissionsBody = document.getElementById("permissionsBody");
if (permissionsBody) {
  permissionsBody.innerHTML = "";
  render(() => createComponent(PermissionsPanel, {}), permissionsBody);
}
const channelConfigBody = document.getElementById("channelConfigBody");
if (channelConfigBody) {
  channelConfigBody.innerHTML = "";
  render(() => createComponent(ChannelsPanel, {}), channelConfigBody);
}
const extensionsBody = document.getElementById("extensionsBody");
if (extensionsBody) {
  extensionsBody.innerHTML = "";
  render(() => createComponent(SkillMarketPanel, {}), extensionsBody);
}
const memoryBody = document.getElementById("memoryBody");
if (memoryBody) {
  memoryBody.innerHTML = "";
  render(() => createComponent(MemoryPanel, {
    get taskID() {
      return boardStore.selectedTaskID || void 0;
    }
  }), memoryBody);
}
const providersConfigBody = document.getElementById("providersConfigBody");
if (providersConfigBody) {
  providersConfigBody.innerHTML = "";
  render(() => createComponent(ProvidersPanel, {}), providersConfigBody);
}
const interactionMountEl = document.getElementById("solidInteractionMount");
if (interactionMountEl) {
  render(() => createComponent(InteractionPanel, {
    onRespond: async () => {
      await loadBoard();
    }
  }), interactionMountEl);
}
document.addEventListener("DOMContentLoaded", () => {
  const openSettings = () => openConfigDialog();
  document.getElementById("btnConfigToggle")?.addEventListener("click", openSettings);
  document.getElementById("btnConfigToggle")?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSettings();
  });
  document.getElementById("btnCloseConfigDialog")?.addEventListener("click", () => {
    document.getElementById("configDialog")?.close();
  });
  document.getElementById("btnCloseSession")?.addEventListener("click", () => {
    document.getElementById("sessionDialog")?.close();
  });
  document.getElementById("configSidebar")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".config-nav-item");
    const tab = btn?.dataset.configTab;
    if (tab) switchConfigTab(tab);
  });
  document.getElementById("brandVersion")?.addEventListener("click", () => {
    openConfigDialog("channel");
  });
  {
    const configResizer = document.getElementById("configResizer");
    const configSidebar = document.getElementById("configSidebar");
    configResizer?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !configSidebar) return;
      configResizer.dataset.active = "true";
      document.body.dataset.resizing = "true";
      e.preventDefault();
      const layout = configSidebar.parentElement;
      function onMove(ev) {
        if (!layout) return;
        const rect = layout.getBoundingClientRect();
        const scale = currentUIScale();
        const min = 140 * scale;
        const max = 320 * scale;
        const next = Math.round(Math.min(max, Math.max(min, ev.clientX - rect.left)));
        configSidebar.style.width = next + "px";
        configSidebar.style.minWidth = next + "px";
      }
      function onUp() {
        delete configResizer.dataset.active;
        delete document.body.dataset.resizing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }
  {
    const resizer = document.getElementById("workspaceResizer");
    const mount = document.getElementById("solidWorkspaceMount");
    const applyHeight = (px) => {
      if (!mount) return;
      mount.style.height = px + "px";
      mount.style.minHeight = px + "px";
      mount.style.maxHeight = px + "px";
    };
    if (settingsStore.workspacePanelHeight != null) {
      applyHeight(settingsStore.workspacePanelHeight);
    }
    resizer?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !mount) return;
      resizer.dataset.active = "true";
      document.body.dataset.resizing = "row";
      e.preventDefault();
      const chatSection = document.getElementById("chatSection");
      const composer = document.getElementById("solidChatComposer");
      function onMove(ev) {
        if (!chatSection) return;
        const rect = chatSection.getBoundingClientRect();
        const scale = currentUIScale();
        const composerH = composer?.getBoundingClientRect().height ?? 0;
        const chatScrollMin = 160 * scale;
        const min = 160 * scale;
        const max = Math.max(min + 40, rect.height - chatScrollMin - composerH);
        const composerTop = composer ? composer.getBoundingClientRect().top : rect.bottom;
        const next = Math.round(Math.min(max, Math.max(min, composerTop - ev.clientY)));
        applyHeight(next);
      }
      function onUp() {
        delete resizer.dataset.active;
        delete document.body.dataset.resizing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const height = mount && mount.style.height ? parseInt(mount.style.height, 10) : null;
        if (Number.isFinite(height) && height > 0) {
          setSettingsStore("workspacePanelHeight", height);
          saveSettings();
        }
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }
  document.getElementById("btnRefreshTasks")?.addEventListener("click", () => {
    void loadTasks();
  });
  document.getElementById("btnSidebarToggle")?.addEventListener("click", () => {
    const next = !settingsStore.sidebarCollapsed;
    setSettingsStore("sidebarCollapsed", next);
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.dataset.collapsed = String(next);
    const toggleBtn = document.getElementById("btnSidebarToggle");
    if (toggleBtn) toggleBtn.title = next ? t("sidebar.open") : t("sidebar.close");
    saveSettings();
  });
  document.getElementById("btnCreateTask")?.addEventListener("click", () => {
    void selectTask("");
    const textarea = document.querySelector("#solidChatComposer textarea");
    textarea?.focus();
  });
  const EXECUTOR_PROVIDER_MAP = {
    codex: ["openai-codex", "openai"],
    "claude-code": ["anthropic"]
  };
  function executorModels(executorID) {
    const catalog = appStore.providerCatalog;
    if (!catalog?.all) return [];
    const providerIDs = EXECUTOR_PROVIDER_MAP[executorID];
    if (!providerIDs) return [];
    const models = [];
    for (const provider of catalog.all) {
      if (!providerIDs.includes(provider.id)) continue;
      if (!provider.models || typeof provider.models !== "object") continue;
      for (const model of Object.values(provider.models)) {
        if (model?.id) models.push(model.id);
      }
    }
    return models;
  }
  function syncExecutorUI() {
    const active = settingsStore.executor || "opencode";
    document.querySelectorAll("[data-executor]").forEach((btn) => {
      btn.dataset.active = String(btn.dataset.executor === active);
    });
  }
  syncExecutorUI();
  syncExecutorWidth();
  function executorModelPanel(id) {
    if (id === "codex") return document.getElementById("codexModelPanel");
    if (id === "claude-code") return document.getElementById("claudeCodeModelPanel");
    return null;
  }
  function closeAllModelPanels() {
    document.getElementById("codexModelPanel")?.setAttribute("hidden", "");
    document.getElementById("claudeCodeModelPanel")?.setAttribute("hidden", "");
  }
  function renderModelPanel(executorID) {
    const panel = executorModelPanel(executorID);
    if (!panel) return;
    const current = executorCurrentModel(executorID);
    const models = executorModels(executorID);
    const currentLabel = current ? `<div class="engine-model-current">${escapeHtml(t("executor.current_model"))}: <strong>${escapeHtml(current)}</strong></div>` : "";
    const items = models.map((mid) => `<button type="button" class="engine-model-item" data-executor-model="${escapeHtml(mid)}" data-active="${mid === current}">${escapeHtml(mid)}</button>`).join("");
    panel.innerHTML = currentLabel + (items || `<div class="engine-model-current">${escapeHtml(t("empty.overview"))}</div>`);
  }
  function openModelPanel(executorID) {
    closeAllModelPanels();
    const panel = executorModelPanel(executorID);
    if (!panel) return;
    renderModelPanel(executorID);
    const caret = document.querySelector(`[data-executor-caret="${executorID}"]`);
    if (caret) {
      const rect = caret.getBoundingClientRect();
      panel.style.top = `${Math.round(rect.bottom + 6)}px`;
      panel.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      panel.style.transform = "translateX(-50%)";
    }
    panel.removeAttribute("hidden");
  }
  const engineBar = document.getElementById("engineBar");
  engineBar?.addEventListener("click", async (event) => {
    const caret = event.target.closest("[data-executor-caret]");
    if (caret) {
      event.stopPropagation();
      const id2 = caret.dataset.executorCaret;
      if (!id2) return;
      const panel = executorModelPanel(id2);
      if (!panel) return;
      if (panel.hasAttribute("hidden")) {
        openModelPanel(id2);
      } else {
        closeAllModelPanels();
      }
      return;
    }
    const modelItem = event.target.closest("[data-executor-model]");
    if (modelItem) {
      event.stopPropagation();
      const model = modelItem.dataset.executorModel;
      const wrap = modelItem.closest("[data-executor-wrap]");
      const executorID = wrap?.dataset.executorWrap;
      if (executorID && model) {
        closeAllModelPanels();
        await setExecutorModel(executorID, model);
      }
      return;
    }
    const chip = event.target.closest("[data-executor]");
    if (!chip || chip.classList.contains("engine-chip-caret")) return;
    const id = chip.dataset.executor;
    if (!id) return;
    if (!executorSelectable(id)) return;
    setSettingsStore("executor", id);
    saveSettings();
    syncExecutorUI();
  });
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-executor-caret]") || e.target?.closest?.(".engine-model-panel")) return;
    closeAllModelPanels();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModelPanels();
  });
});
document.getElementById("btnWorkspaceToggle")?.addEventListener("click", () => {
  toggleWorkspace();
});
document.getElementById("btnChatCopyAll")?.addEventListener("click", () => {
  void copyChatConversation();
});
const BUILD_SCROLL_SELECTOR = "#solidWorkspaceMount .workspace-view[data-kind='build']";
document.body.addEventListener("pointerdown", (event) => {
  if (!workspaceOpen()) return;
  if (workspaceView().kind !== "build") return;
  const target = event.target;
  if (!target) return;
  if (target.closest(BUILD_SCROLL_SELECTOR)) {
    if (composerTarget() !== "build") setComposerTarget("build");
    return;
  }
  if (target.closest("#chatScroll")) {
    if (composerTarget() !== "task") setComposerTarget("task");
  }
});
const interactionBridge = createOverlayInteractions({
  document,
  dom: {
    goalsBody: null
  },
  escapeHtml,
  renderMarkdown,
  t,
  record: isRecord,
  loadBoard,
  nativePrompt: async (message, options = {}) => {
    const showAppDialog = window.showAppDialog;
    if (typeof showAppDialog !== "function") return null;
    const result = await showAppDialog({
      title: options.title,
      message,
      cancel: true,
      input: true,
      okLabel: options.okLabel,
      cancelLabel: options.cancelLabel,
      inputLabel: options.inputLabel
    });
    return result?.confirmed ? result.value : null;
  }
});
Object.assign(window, {
  renderInteractions: interactionBridge.renderInteractions,
  showInteractionModal: interactionBridge.showInteractionModal,
  dismissInteractionModal: interactionBridge.dismissInteractionModal,
  resolveInteraction: interactionBridge.resolveInteraction,
  rejectInteraction: interactionBridge.rejectInteraction,
  isInteractionBusy: interactionBridge.isInteractionBusy,
  refreshInteractionAttention: interactionBridge.refreshInteractionAttention
});
createRoot(() => {
  createEffect(() => {
    document.body.dataset.workspace = !appStore.connected ? "offline" : boardStore.selectedTaskID ? "task" : "empty";
    document.body.dataset.connection = appStore.connectionStatus;
  });
  createEffect(() => {
    applyTheme(settingsStore.theme);
    applyZoom(settingsStore.zoom);
    void applyWindowOpacity(settingsStore.opacity);
  });
  createEffect(() => {
    configure({
      serverUrl: settingsStore.serverUrl,
      username: settingsStore.username,
      password: settingsStore.password,
      directory: settingsStore.directory
    });
  });
  createEffect(() => {
    void setLocale(settingsStore.locale);
  });
  createEffect(() => {
    settingsStore.locale;
    appStore.config;
    appStore.providerCatalog;
    appStore.providerAuth;
    appStore.providerTest;
    refreshInlineLlmConfig();
  });
  createEffect(() => {
    const count = store.messages.length;
    const chatCount = document.getElementById("chatCount");
    const copyBtn = document.getElementById("btnChatCopyAll");
    if (chatCount) chatCount.textContent = count > 0 ? String(count) : "";
    if (copyBtn) copyBtn.disabled = count === 0;
  });
  createEffect(() => {
    const open = workspaceOpen();
    const view = workspaceView();
    const target = composerTarget();
    const mount = document.getElementById("solidWorkspaceMount");
    const resizer = document.getElementById("workspaceResizer");
    if (mount) mount.hidden = !open;
    if (resizer) resizer.hidden = !open;
    const toggleBtn = document.getElementById("btnWorkspaceToggle");
    if (toggleBtn) toggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
    const chatEl = document.getElementById("chatScroll");
    const buildEl = document.querySelector("#solidWorkspaceMount .workspace-view[data-kind='build']");
    const highlightActive = open && view.kind === "build";
    const chatFocused = highlightActive && target === "task";
    const buildFocused = highlightActive && target === "build";
    if (chatEl) chatEl.classList.toggle("chat-scroll--focused", chatFocused);
    if (buildEl) buildEl.classList.toggle("chat-scroll--focused", buildFocused);
  });
  createEffect(() => {
    const task = boardStore.board?.task;
    const taskStatus = document.getElementById("taskStatus");
    const statusIconEl = document.getElementById("statusIcon");
    const statusLabelEl = document.getElementById("statusLabel");
    const status = task?.status || "idle";
    if (taskStatus) {
      taskStatus.hidden = !boardStore.selectedTaskID;
    }
    if (statusIconEl) {
      statusIconEl.dataset.status = status;
      statusIconEl.innerHTML = statusIcon(status);
    }
    if (statusLabelEl) {
      statusLabelEl.textContent = boardStore.selectedTaskID ? t(`task.status.${status}`) : t("task.status.idle");
    }
  });
  const elapsedInterval = setInterval(() => {
    const elapsedEl = document.getElementById("taskElapsed");
    if (!elapsedEl) return;
    const task = boardStore.board?.task;
    const startTime = task?.time?.created || 0;
    if (!boardStore.selectedTaskID || !startTime) {
      if (elapsedEl.textContent) elapsedEl.textContent = "";
      return;
    }
    const completedTime = task?.time?.completed || 0;
    const status = task?.status || "idle";
    const isActive = ["active", "queued"].includes(status);
    const end = completedTime && !isActive ? completedTime : Date.now();
    elapsedEl.textContent = formatDuration(end - startTime);
  }, 1e3);
  onCleanup(() => clearInterval(elapsedInterval));
  createEffect(() => {
    settingsStore.locale;
    appStore.budgetDirty;
    appStore.budgetSaving;
    renderBudget(boardStore.board?.task);
  });
});
const paneCallbacks = {
  getState: () => ({
    sidebarCollapsed: settingsStore.sidebarCollapsed,
    sidebarWidth: settingsStore.sidebarWidth,
    sectionsWidth: settingsStore.sectionsWidth
  }),
  onWidthsChanged: (sidebarWidth, sectionsWidth) => {
    setSettingsStore({
      ...sidebarWidth != null ? {
        sidebarWidth
      } : {},
      ...sectionsWidth != null ? {
        sectionsWidth
      } : {}
    });
    saveSettings();
  }
};
initPaneResizers(paneCallbacks);
window.addEventListener("keydown", handleZoomHotkey);
window.addEventListener("keydown", (e) => {
  if (e.key === "F12") {
    e.preventDefault();
    void toggleDevtools();
  }
});
const onResize = () => applyZoom(settingsStore.zoom);
window.addEventListener("resize", onResize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
window.addEventListener("focus", () => {
  void window.refreshInteractionAttention?.();
});
window.addEventListener("blur", () => {
  void cancelPaneResize(paneCallbacks);
  void window.refreshInteractionAttention?.();
});
window.addEventListener("beforeunload", () => {
  teardownApp();
  stopTimers();
});
document.addEventListener("visibilitychange", () => {
  void window.refreshInteractionAttention?.();
});
installSystemThemeListener(() => applyTheme(settingsStore.theme));
function renderRecentDirPanel() {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  const dirs = loadRecentDirectories();
  const current = activeDirectory();
  if (!dirs.length) {
    panel.innerHTML = `<div class="recent-dir-empty">${escapeHtml(t("cwd.recent_empty"))}</div>`;
    return;
  }
  panel.innerHTML = dirs.map((dir) => {
    const isActive = current && dir.toLowerCase() === current.toLowerCase();
    return `<div class="recent-dir-row" data-active="${isActive}"><button type="button" class="recent-dir-item" data-recent-dir="${escapeHtml(dir)}" title="${escapeHtml(dir)}">${escapeHtml(shortPath$2(dir))}</button><button type="button" class="recent-dir-remove" data-recent-remove="${escapeHtml(dir)}" title="${escapeHtml(t("common.delete"))}" aria-label="${escapeHtml(t("common.delete"))}">×</button></div>`;
  }).join("");
}
function openRecentDirPanel() {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  renderRecentDirPanel();
  const trigger = document.getElementById("taskDir")?.querySelector('[data-path-action="recent"]');
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 4) + "px";
    panel.style.left = Math.round(Math.max(4, rect.left - 60)) + "px";
  }
  panel.hidden = false;
}
function closeRecentDirPanel() {
  const panel = document.getElementById("recentDirPanel");
  if (panel) panel.hidden = true;
}
document.getElementById("taskDir")?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-path-action],[data-path-open],[data-path-set]");
  if (!button || button.disabled) return;
  const el = button;
  const action = el.dataset.pathAction || "";
  if (action === "recent") {
    event.stopPropagation();
    openRecentDirPanel();
    return;
  }
  if (action === "browse") {
    await browseDirectory();
    return;
  }
  if (action === "create") {
    await createDirectory();
    return;
  }
  if (action === "reset") {
    await resetDirectory();
    return;
  }
  if (el.dataset.pathOpen) {
    await openDirectory(el.dataset.pathOpen);
    return;
  }
  const target = el.dataset.pathSet || "";
  if (!target) return;
  try {
    await setDirectory(target);
  } catch (e) {
    AppLog.error("ui", "Failed to set working directory", {
      error: String(e)
    });
  }
});
document.getElementById("recentDirPanel")?.addEventListener("click", async (event) => {
  const removeBtn = eventClosest(event, "[data-recent-remove]");
  if (removeBtn) {
    const dir2 = removeBtn.dataset.recentRemove;
    if (dir2) {
      removeRecentDirectory(dir2);
      renderRecentDirPanel();
      if (!loadRecentDirectories().length) closeRecentDirPanel();
    }
    return;
  }
  const item = eventClosest(event, "[data-recent-dir]");
  if (!item) return;
  const dir = item.dataset.recentDir;
  if (!dir) return;
  closeRecentDirPanel();
  try {
    await setDirectory(dir);
  } catch (e) {
    AppLog.error("ui", "Failed to switch to recent directory", {
      dir,
      error: String(e)
    });
  }
});
document.addEventListener("click", (e) => {
  const target = e.target;
  if (target?.closest?.('[data-path-action="recent"]') || target?.closest?.(".recent-dir-panel")) return;
  closeRecentDirPanel();
});
document.getElementById("taskGit")?.addEventListener("click", () => {
  void initGitCurrent({
    notify: true
  });
});
window.__overlayInitSettled = false;
void (async () => {
  try {
    await initApp();
    renderAboutVersion();
  } catch (error) {
    console.error(error);
  } finally {
    await waitForLogDrain();
    window.__overlayInitSettled = true;
  }
})();
