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
function children(fn) {
  const children = createMemo(fn);
  const memo = createMemo(() => resolveChildren(children()));
  memo.toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo;
}
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
  if (Array.isArray(handler)) {
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

function escapeHtml$1(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inlineMarkdown(text) {
  let s = escapeHtml$1(text);
  function unescapeUrl(url) {
    return url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  }
  function safeUrl(url, image = false) {
    const value = unescapeUrl(url).trim();
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return null;
    if (lower.startsWith("data:"))
      return image && lower.startsWith("data:image/") ? value : null;
    if (lower.startsWith("https://") || lower.startsWith("http://") || lower.startsWith("mailto:") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("#"))
      return value;
    return null;
  }
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const value = safeUrl(url, true);
    return value ? `<img class="md-img" src="${value}" alt="${alt}" loading="lazy">` : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const value = safeUrl(url);
    return value ? `<a class="md-link" href="${value}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  return s;
}
function renderMarkdownBlock(text) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  let listTag = "ul";
  for (const line of lines) {
    const trimmed = line.trim();
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) {
        html += `</${listTag}>`;
        inList = false;
      }
      const level = hMatch[1].length;
      html += `<div class="md-h${level}">${inlineMarkdown(hMatch[2])}</div>`;
      continue;
    }
    if (/^[-*]\s/.test(trimmed)) {
      if (!inList || listTag !== "ul") {
        if (inList) html += `</${listTag}>`;
        html += '<ul class="md-list">';
        inList = true;
        listTag = "ul";
      }
      html += `<li>${inlineMarkdown(trimmed.slice(2))}</li>`;
      continue;
    }
    const olMatch = trimmed.match(/^(\d+)\.\s(.+)$/);
    if (olMatch) {
      if (!inList || listTag !== "ol") {
        if (inList) html += `</${listTag}>`;
        html += '<ol class="md-list">';
        inList = true;
        listTag = "ol";
      }
      html += `<li>${inlineMarkdown(olMatch[2])}</li>`;
      continue;
    }
    if (inList) {
      html += `</${listTag}>`;
      inList = false;
    }
    if (!trimmed) {
      html += '<div class="md-break"></div>';
      continue;
    }
    html += `<div class="md-p">${inlineMarkdown(trimmed)}</div>`;
  }
  if (inList) html += `</${listTag}>`;
  return html;
}
function renderMarkdown$1(text) {
  const segments = text.split(/(```[\s\S]*?```)/g);
  let html = "";
  for (const seg of segments) {
    if (seg.startsWith("```")) {
      const match = seg.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const code = match ? match[2] : seg.slice(3, -3);
      html += `<pre class="md-code-block"><code>${escapeHtml$1(code.replace(/\n$/, ""))}</code></pre>`;
    } else {
      html += renderMarkdownBlock(seg);
    }
  }
  return html;
}

var _tmpl$$j = /* @__PURE__ */ template(`<div class=msg-text>`);
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
        const html = renderMarkdown$1(blocks[i]);
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
      activeEl.innerHTML = renderMarkdown$1(activeText);
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
    var _el$ = _tmpl$$j();
    var _ref$ = containerRef;
    typeof _ref$ === "function" ? use(_ref$, _el$) : containerRef = _el$;
    return _el$;
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
function record$8(value) {
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
  if (record$8(source) && Object.hasOwn(source, key)) return source[key];
  return key.split(".").reduce((acc, part) => record$8(acc) ? acc[part] : void 0, source);
}
function fillTemplate(text, vars = {}) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split(".").reduce(
      (acc, part) => record$8(acc) ? acc[part] : void 0,
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
  if (record$8(value)) {
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
  messages[normalized] = record$8(data) ? data : {};
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
      return [locale, record$8(data) ? data : {}];
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

function stripAnsi$1(str) {
  if (!str) return "";
  return str.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ""
  );
}
function record$7(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function toolNameKey(name) {
  return String(name || "").toLowerCase().replace(/[\s_-]+/g, "");
}
function toolInputCommand(input) {
  if (!record$7(input)) return "";
  const value = input.command ?? input.argv ?? input.cmd;
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap(
    (item) => typeof item === "string" && item.trim() ? [item.trim()] : []
  ).join(" ").trim();
}
function clipText$2(value, limit = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
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
  if (n === "bash" || n === "shellcommand") return "💻";
  if (n === "grep" || n === "searchcode") return "🔍";
  if (n === "glob" || n === "findfiles") return "📂";
  if (n === "agent" || n === "spawnagent") return "🤖";
  if (n === "todowrite" || n === "todoupdate" || n === "updateplan") return "☑️";
  return "⚡";
}
function displayToolDetail(name, input, state, base = "") {
  const safeInput = record$7(input) ? input : {};
  const safeState = record$7(state) ? state : {};
  const n = toolNameKey(name);
  const path = safeInput.file_path || safeInput.filePath || safeInput.path || safeInput.filename || "";
  if (path) return shortRelativePath(path, base);
  if (n === "bash" || n === "shellcommand")
    return clipText$2(toolInputCommand(safeInput), 80);
  if (n === "grep" || n === "searchcode")
    return safeInput.pattern || safeInput.query || safeInput.q || "";
  if (n === "glob" || n === "findfiles")
    return safeInput.pattern || safeInput.glob || "";
  if (n === "agent" || n === "spawnagent")
    return clipText$2(safeInput.description || safeInput.prompt || "", 80);
  if (typeof safeInput.raw === "string" && safeInput.raw.trim())
    return clipText$2(safeInput.raw, 80);
  if ((safeState.status === "completed" || safeState.status === "running") && typeof safeState.title === "string")
    return safeState.title;
  return "";
}
function toolStatusLabel(status) {
  if (status === "completed") return t("task.status.completed");
  if (status === "running") return t("task.status.running");
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

const [store$1, setStore$1] = createStore({
  expandedAgentCards: {},
  expandedToolOutputs: {}
});
function clearConversationUiState() {
  setStore$1("expandedAgentCards", reconcile({}, { merge: false }));
  setStore$1("expandedToolOutputs", reconcile({}, { merge: false }));
}
function agentCardExpanded(cardID, running) {
  if (!cardID) return running;
  const explicit = store$1.expandedAgentCards[cardID];
  return typeof explicit === "boolean" ? explicit : running;
}
function toggleAgentCardExpanded(cardID, running) {
  if (!cardID) return;
  const next = !agentCardExpanded(cardID, running);
  setStore$1("expandedAgentCards", cardID, next);
}
function toolOutputExpanded(partID) {
  if (!partID) return false;
  return store$1.expandedToolOutputs[partID] === true;
}
function toggleToolOutputExpanded(partID) {
  if (!partID) return;
  setStore$1("expandedToolOutputs", partID, (value) => value !== true);
}

const reasoningVisibility = /* @__PURE__ */ new Map();
const reasoningHideTimers = /* @__PURE__ */ new Map();
const DEFAULT_REASONING_AUTO_CLOSE_MS = 5e3;
const [reasoningRevision, setReasoningRevision] = createSignal(0);
function record$6(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function reasoningPartKey(part) {
  if (!record$6(part)) return "";
  const id = typeof part.id === "string" ? part.id : "";
  const messageID = typeof part.messageID === "string" ? part.messageID : "";
  const sessionID = typeof part.sessionID === "string" ? part.sessionID : "";
  if (!id && !messageID && !sessionID) return "";
  return `reasoning:${sessionID}:${messageID}:${id}`;
}
function reasoningPartHidden(part) {
  const key = reasoningPartKey(part);
  return key ? reasoningVisibility.get(key)?.hidden === true : false;
}
function reasoningAutoCloseMs() {
  const testConfig = window.__overlayTest;
  const value = testConfig && typeof testConfig === "object" ? Number(testConfig.reasoningAutoCloseMs) : NaN;
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  return DEFAULT_REASONING_AUTO_CLOSE_MS;
}
function stopReasoningHideTimer(key) {
  const timer = reasoningHideTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  reasoningHideTimers.delete(key);
}
function scheduleReasoningAutoHide(key) {
  if (!key) return;
  stopReasoningHideTimer(key);
  const timer = setTimeout(() => {
    reasoningHideTimers.delete(key);
    const current = reasoningVisibility.get(key) || { hidden: false };
    if (current.hidden) return;
    reasoningVisibility.set(key, { ...current, hidden: true });
    setReasoningRevision((r) => r + 1);
  }, reasoningAutoCloseMs());
  reasoningHideTimers.set(key, timer);
}
function touchReasoningPart$1(part) {
  const key = reasoningPartKey(part);
  if (!key) return;
  const current = reasoningVisibility.get(key);
  reasoningVisibility.set(key, { ...current || {}, hidden: false });
  stopReasoningHideTimer(key);
  scheduleReasoningAutoHide(key);
  if (current?.hidden) {
    setReasoningRevision((r) => r + 1);
  }
}

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
    budgetMaxEvaluations: $("#budgetMaxEvaluations"),
    budgetMaxWallTime: $("#budgetMaxWallTime"),
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
    chatTabs: $("#chatTabs"),
    tabControl: $("#tabControl"),
    tabCoding: $("#tabCoding"),
    codingScroll: $("#codingScroll"),
    codingEmpty: $("#codingEmpty"),
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

const AGENT_CARD_STAGES = /* @__PURE__ */ new Set(["orchestrator", "spec", "planner", "goal", "executor", "evaluator", "delivery"]);
function normalizeAgentRole(name) {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return "assistant";
  if (text === "user") return "user";
  if (text === "orchestrator" || text === "task_agent") return "orchestrator";
  if (text === "spec") return "spec";
  if (text === "planner" || text === "plan" || text === "planning" || text === "replan") return "planner";
  if (text === "goal" || text === "goal_gate") return "goal";
  if (text === "executor" || text === "build" || text === "coding" || text === "general" || text === "explore" || text === "execute") return "executor";
  if (text === "judge" || text === "evaluator" || text === "evaluation" || text === "scheduler" || text === "review" || text === "evaluate") return "evaluator";
  if (text === "delivery" || text === "deliver" || text === "files" || text === "publish") return "delivery";
  if (text === "system" || text === "compaction" || text === "title" || text === "summary") return "system";
  return "assistant";
}
function agentRoleToSectionPhase(role) {
  if (role === "spec") return "spec";
  if (role === "planner") return "plan";
  if (role === "goal") return "goals";
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
  if (String(msg?.info?.role || "").trim().toLowerCase() === "user") return "main";
  const backendChannel = String(msg?.info?.channel || "").trim().toLowerCase();
  if (backendChannel && backendChannel !== "main") {
    const resolved = String(msg?.info?.resolvedRole || "").trim().toLowerCase();
    if (AGENT_CARD_STAGES.has(resolved)) return resolved;
    if (backendChannel === "filtered") return "filtered";
  }
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  const role = normalizeAgentRole(agent);
  if (AGENT_CARD_STAGES.has(role)) return role;
  const sessionID = typeof msg?.info?.sessionID === "string" ? msg.info.sessionID : "";
  if (rootSessionID && sessionID && sessionID !== rootSessionID) return "executor";
  return "main";
}
function effectiveRole(msg, _rootSessionID) {
  return msg.info?.resolvedRole || msg.info?.role || "assistant";
}

function phaseSections() {
  const dom = getDomRefs();
  return {
    spec: dom.specSection,
    plan: dom.planSection,
    goals: dom.goalsSection,
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
  const planning = board?.task ? board.task.status === "planning" || board.run?.phase === "plan" || board.run?.phase === "replan" : false;
  const active = [];
  const related = [];
  if (live) {
    active.push(live);
    relatePhase(live, related, board, goals, changesCount);
  }
  if (board?.task && (pending || board.task.status === "blocked")) {
    active.length = 0;
    if (board.plan) active.push("plan");
    else if (goals.length > 0) active.push("goals");
    else if (board.spec) active.push("spec");
  }
  if (board?.task && active.length === 0 && board.task.status === "queued") {
    if (board.spec) active.push("spec");
    else if (board.plan) active.push("plan");
  }
  if (board?.task && active.length === 0 && planning) {
    active.push(board.spec ? "plan" : "spec");
    if (board.spec) related.push("spec");
    if (board.plan) related.push("plan");
  }
  if (board?.task && active.length === 0 && board.task.status === "running") {
    active.push(goals.length > 0 ? "goals" : board.plan ? "plan" : "spec");
    if (board.plan) related.push("plan");
    if (changesCount > 0) related.push("files");
  }
  if (board?.task && active.length === 0 && board.task.status === "evaluating") {
    active.push("evaluation");
    if (goals.length > 0) related.push("goals");
    if (changesCount > 0) related.push("files");
  }
  if (board?.task && active.length === 0 && board.task.status === "delivering") {
    active.push("delivery");
    if (changesCount > 0) related.push("files");
    if (board.evaluation) related.push("evaluation");
    if (goals.length > 0) related.push("goals");
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
  agentCards: {},
  agentCardOrder: [],
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
function messageTime(item) {
  return finiteMessageTime(item) ?? 0;
}
function messageOrderTime(item) {
  return finiteMessageTime(item) ?? UNTIMED_MESSAGE_ORDER;
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
function record$5(value) {
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
  if (!record$5(value)) return JSON.stringify(String(value));
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
    audience: record$5(part?.audience) ? part.audience : null,
    state: record$5(part?.state) ? part.state : part?.state ?? null,
    files: Array.isArray(part?.files) ? part.files : [],
    process: record$5(part?.process) ? part.process : null
  });
}
function messageSignature(message) {
  const info = record$5(message?.info) ? message.info : {};
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
  const part = record$5(input) ? { ...input } : { type: "text", text: String(input || "") };
  const id = typeof part.id === "string" && part.id.trim() ? part.id.trim() : `loaded-part:${messageID}:${index}:${hashText$1(partSignature(part))}`;
  return {
    ...part,
    id,
    messageID: typeof part.messageID === "string" && part.messageID.trim() ? part.messageID.trim() : messageID,
    sessionID: typeof part.sessionID === "string" && part.sessionID.trim() ? part.sessionID.trim() : sessionID
  };
}
function normalizeLoadedMessage(input) {
  const message = record$5(input) ? input : {};
  const info = record$5(message.info) ? message.info : {};
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
    const info = record$5(item?.info) ? item.info : {};
    const key = typeof info.id === "string" && info.id.trim() ? `id:${info.id.trim()}` : `sig:${messageSignature(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return normalizeLoadedMessages(result);
}
function activeAgentStages() {
  const status = String(boardStore.board?.task?.status || "").trim().toLowerCase();
  if (status === "spec_generating") return /* @__PURE__ */ new Set(["spec"]);
  if (status === "goal_decomposing") return /* @__PURE__ */ new Set(["goal"]);
  if (status === "planning") return /* @__PURE__ */ new Set(["planner"]);
  if (status === "running") return /* @__PURE__ */ new Set(["executor"]);
  if (status === "evaluating") return /* @__PURE__ */ new Set(["evaluator"]);
  if (status === "delivering") return /* @__PURE__ */ new Set(["delivery"]);
  if (!status && Array.isArray(store.agentEvents) && store.agentEvents.length > 0) {
    return new Set(
      store.agentEvents.map((item) => {
        const raw = String(item?.stage || "").trim().toLowerCase();
        return raw ? normalizeAgentRole(raw) : "";
      }).filter((r) => r && AGENT_CARD_STAGES.has(r))
    );
  }
  return /* @__PURE__ */ new Set();
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
function agentMessage(event) {
  if (!event || typeof event !== "object") return null;
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return null;
  const created = agentEventTime(event) || Date.now();
  const eventID = typeof event?.id === "string" && event.id ? event.id : `${stage}:${String(event?.kind || "status")}:${created}`;
  const kind = String(event?.kind || "status").trim().toLowerCase();
  const text = agentEventDisplayText(event).trim();
  const msgID = `agent-event:${stage}:${eventID}`;
  const cacheKey = `${msgID}:${kind}:${text}`;
  const cached = _agentMsgCache.get(cacheKey);
  if (cached) return cached;
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
  if (msg) _agentMsgCache.set(cacheKey, msg);
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
let _rebuildScheduled = false;
function scheduleRebuildAgentCards() {
  if (_rebuildScheduled) return;
  _rebuildScheduled = true;
  requestAnimationFrame(() => {
    _rebuildScheduled = false;
    rebuildAgentCards();
  });
}
function rebuildAgentCards() {
  const roundsByStage = {};
  const latestEventByStage = /* @__PURE__ */ new Map();
  const rootSID = rootTaskSessionID();
  for (const message of store.messages) {
    const stage = message.info?.channel || classifyMessage(message, rootSID);
    if (stage === "main" || stage === "filtered") continue;
    const sessionID = typeof message?.info?.sessionID === "string" ? message.info.sessionID.trim() : "";
    const fallbackID = typeof message?.info?.id === "string" && message.info.id ? message.info.id : hashText$1(messageSignature(message));
    const channelID = stage === "executor" ? `${stage}:message:${fallbackID}` : sessionID ? `${stage}:session:${sessionID}` : `${stage}:message:${fallbackID}`;
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
  for (const event of Array.isArray(store.agentEvents) ? store.agentEvents : []) {
    const rawStage = String(event?.stage || "").trim().toLowerCase();
    const stage = normalizeAgentRole(rawStage);
    if (!AGENT_CARD_STAGES.has(stage)) continue;
    const items = liveEventsByStage.get(stage) || [];
    items.push(event);
    liveEventsByStage.set(stage, items);
    latestEventByStage.set(stage, event);
  }
  for (const [stage, events] of liveEventsByStage.entries()) {
    const mergedEvents = mergeAgentReasoningDeltas(
      events.slice().sort((left, right) => agentEventTime(left) - agentEventTime(right))
    );
    const liveMessages = mergedEvents.map((event) => agentMessage(event)).filter(Boolean).slice(-12);
    if (liveMessages.length === 0) continue;
    const existing = roundsByStage[stage] || [];
    if (existing.length > 0) continue;
    existing.push({
      channelID: `${stage}:live`,
      stage,
      sessionID: "",
      messages: liveMessages,
      startTime: messageTime(liveMessages[0]),
      endTime: Math.max(...liveMessages.map((message) => messageEndTime(message)))
    });
    roundsByStage[stage] = existing;
  }
  const goalsBySession = /* @__PURE__ */ new Map();
  const goalsLane = (boardStore.board?.lanes || []).find((l) => l.id === "goals");
  for (const card of goalsLane?.cards || []) {
    const sid = card?.metadata?.sessionID;
    if (typeof sid === "string" && sid) {
      goalsBySession.set(sid, {
        id: card.id,
        title: card.title || "",
        status: card.status || "pending"
      });
    }
  }
  const nextCards = {};
  const nextOrder = [];
  function buildCard(stage, round, roundLabel, status) {
    const created = Number.isFinite(round.startTime) && round.startTime > 0 ? round.startTime : Date.now();
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
  for (const [stage, rounds] of Object.entries(roundsByStage)) {
    rounds.sort((left, right) => left.startTime - right.startTime);
    if (stage === "executor") {
      const bySession = /* @__PURE__ */ new Map();
      const noSession = [];
      for (const round of rounds) {
        const sid = round.sessionID || "";
        if (sid) {
          const arr = bySession.get(sid) || [];
          arr.push(round);
          bySession.set(sid, arr);
        } else {
          noSession.push(round);
        }
      }
      if (bySession.size <= 1 && noSession.length === 0) {
        const allRounds = [...bySession.values()].flat();
        if (allRounds.length > 0) {
          const merged = {
            channelID: `executor:session:${allRounds[0].sessionID}`,
            stage,
            sessionID: allRounds[0].sessionID,
            messages: allRounds.flatMap((r) => r.messages),
            startTime: Math.min(...allRounds.map((r) => r.startTime)),
            endTime: Math.max(...allRounds.map((r) => r.endTime))
          };
          const status = agentRoundStatus(stage, merged, 0, [merged], latestEventByStage.get(stage));
          const cardID = merged.channelID;
          nextCards[cardID] = buildCard(stage, merged, 0, status);
          nextOrder.push(cardID);
        }
        continue;
      }
      for (const [sid, sessionRounds] of bySession) {
        const groupKey = `executor:session:${sid}`;
        sessionRounds.sort((left, right) => left.startTime - right.startTime);
        const childCards = [];
        for (let i = 0; i < sessionRounds.length; i += 1) {
          const round = sessionRounds[i];
          const childLabel = sessionRounds.length > 1 ? i + 1 : 0;
          const childStatus = agentRoundStatus(stage, round, i, sessionRounds, void 0);
          childCards.push(buildCard(stage, round, childLabel, childStatus));
        }
        const groupStart = Math.min(...sessionRounds.map((r) => r.startTime));
        const groupStatus = childCards.some((c) => c._agentStatus === "running") ? "running" : childCards.some((c) => c._agentStatus === "error") ? "error" : "completed";
        const goalInfo = goalsBySession.get(sid);
        nextCards[groupKey] = {
          _synthetic: true,
          _agentCard: true,
          _agentGoalGroup: true,
          _agentGoalID: goalInfo?.id || sid,
          _agentGoalTitle: goalInfo?.title || "",
          _agentGoalStatus: goalInfo?.status || "running",
          _agentInternalCards: childCards,
          _agentStage: stage,
          _agentStatus: groupStatus,
          _agentRound: 0,
          _agentCardKey: groupKey,
          _agentMessages: [],
          info: {
            id: `agent-card:${groupKey}`,
            role: "agent-card",
            agent: stage,
            sessionID: sid,
            time: { created: Number.isFinite(groupStart) && groupStart > 0 ? groupStart : Date.now() }
          },
          parts: []
        };
        nextOrder.push(groupKey);
      }
      for (let i = 0; i < noSession.length; i += 1) {
        const round = noSession[i];
        const label = noSession.length > 1 ? i + 1 : 0;
        const status = agentRoundStatus(stage, round, i, noSession, void 0);
        nextCards[round.channelID] = buildCard(stage, round, label, status);
        nextOrder.push(round.channelID);
      }
      continue;
    }
    for (let index = 0; index < rounds.length; index += 1) {
      const round = rounds[index];
      const roundLabel = rounds.length > 1 ? index + 1 : 0;
      const status = agentRoundStatus(
        stage,
        round,
        index,
        rounds,
        latestEventByStage.get(stage)
      );
      const cardID = round.channelID;
      nextCards[cardID] = buildCard(stage, round, roundLabel, status);
      nextOrder.push(cardID);
    }
  }
  nextOrder.sort(
    (left, right) => messageOrderTime(nextCards[left]) - messageOrderTime(nextCards[right]) || left.localeCompare(right)
  );
  batch(() => {
    const prevKeys = Object.keys(store.agentCards);
    for (const key of prevKeys) {
      if (!(key in nextCards)) {
        setStore("agentCards", key, void 0);
      }
    }
    for (const [cardID, card] of Object.entries(nextCards)) {
      if (cardID in store.agentCards) {
        const prev = store.agentCards[cardID];
        if (prev._agentStatus !== card._agentStatus) {
          setStore("agentCards", cardID, "_agentStatus", card._agentStatus);
        }
        if (prev._agentRound !== card._agentRound) {
          setStore("agentCards", cardID, "_agentRound", card._agentRound);
        }
        if (card._agentGoalGroup) {
          if (prev._agentGoalStatus !== card._agentGoalStatus) {
            setStore("agentCards", cardID, "_agentGoalStatus", card._agentGoalStatus);
          }
          if (prev._agentGoalTitle !== card._agentGoalTitle) {
            setStore("agentCards", cardID, "_agentGoalTitle", card._agentGoalTitle);
          }
          const prevInternals = prev._agentInternalCards || [];
          const nextInternals = card._agentInternalCards || [];
          if (prevInternals.length !== nextInternals.length || prevInternals.some((c, i) => {
            const n = nextInternals[i];
            if (!n) return true;
            if (c._agentCardKey !== n._agentCardKey) return true;
            if (c._agentStatus !== n._agentStatus) return true;
            if (c._agentRound !== n._agentRound) return true;
            const pm = c._agentMessages || [];
            const nm = n._agentMessages || [];
            return pm.length !== nm.length || pm.some((m, j) => m !== nm[j]);
          })) {
            setStore("agentCards", cardID, "_agentInternalCards", [...nextInternals]);
          }
        }
        const prevMsgs = prev._agentMessages;
        const nextMsgs = card._agentMessages;
        if (prevMsgs.length !== nextMsgs.length || prevMsgs.some((m, i) => m !== nextMsgs[i])) {
          setStore("agentCards", cardID, "_agentMessages", [...nextMsgs]);
        }
      } else {
        setStore("agentCards", cardID, {
          ...card,
          _agentMessages: [...card._agentMessages],
          ...card._agentInternalCards ? { _agentInternalCards: [...card._agentInternalCards] } : {}
        });
      }
    }
    const prevOrder = store.agentCardOrder;
    if (prevOrder.length !== nextOrder.length || prevOrder.some((id, i) => id !== nextOrder[i])) {
      setStore("agentCardOrder", nextOrder);
    }
  });
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
    const msg = { info: mergeMessageInfo(void 0, info), parts: [] };
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
      const msg = {
        info: {
          id: part.messageID,
          sessionID: part.sessionID,
          role: "assistant",
          resolvedRole: properties.resolvedRole || "assistant",
          channel: properties.channel || "main",
          time: { created: part.state?.time?.start || Date.now() }
        },
        parts: []
      };
      let partInsertIdx = 0;
      setStore(
        "messages",
        produce((msgs) => {
          partInsertIdx = insertSorted(msgs, msg);
        })
      );
      message = store.messages[partInsertIdx];
      messageIndex.set(part.messageID, message);
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
      const msg = {
        info: {
          id: properties.messageID,
          sessionID: properties.sessionID,
          role: "assistant",
          resolvedRole: properties.resolvedRole || "assistant",
          channel: properties.channel || "main",
          time: { created: Date.now() }
        },
        parts: []
      };
      let deltaInsertIdx = 0;
      setStore(
        "messages",
        produce((msgs) => {
          deltaInsertIdx = insertSorted(msgs, msg);
        })
      );
      message = store.messages[deltaInsertIdx];
      messageIndex.set(properties.messageID, message);
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
  let needsUpdate = false;
  batch(() => {
    for (const event of events) {
      if (applyMessageEvent(event)) needsUpdate = true;
    }
  });
  if (needsUpdate) {
    scheduleRebuildAgentCards();
  }
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
  const keys = new Set(kept.map((event) => agentEventKey(event)));
  for (const key of [...agentLiveTimers.keys()]) {
    if (!keys.has(key)) stopAgentLiveTimer(key);
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
function mergeAgentEventList(events, raw) {
  const event = agentEventEntry(raw);
  if (!event) return events;
  if (event.taskID && boardStore.selectedTaskID && event.taskID !== boardStore.selectedTaskID) {
    return events;
  }
  const index = events.findIndex(
    (item) => item.id === event.id && item.stage === event.stage
  );
  const next = index >= 0 ? [
    ...events.slice(0, index),
    mergeAgentEvent(events[index], event),
    ...events.slice(index + 1)
  ] : [...events, event];
  const target = index >= 0 ? next[index] : next[next.length - 1];
  syncAgentText(target);
  return pruneAgentEvents(
    next.sort(
      (a, b) => (a.time?.created || 0) - (b.time?.created || 0)
    )
  );
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
  let merged = [...store.agentEvents];
  for (const raw of queued) {
    merged = mergeAgentEventList(merged, raw);
  }
  setStore("agentEvents", reconcile(merged));
  scheduleRebuildAgentCards();
  for (const raw of queued) {
    const payload = agentEventRecord(raw?.payload) ? raw.payload : agentEventRecord(raw?.properties) ? raw.properties : {};
    const key = agentEventKey({
      stage: String(payload.stage || "").trim().toLowerCase(),
      id: typeof payload.id === "string" && payload.id ? payload.id : typeof raw?.event_id === "string" ? raw.event_id : ""
    });
    const target = key ? merged.find((item) => agentEventKey(item) === key) || null : null;
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
  setStore("agentEvents", reconcile(normalized));
  scheduleRebuildAgentCards();
}
function clearAgentEvents() {
  for (const key of [...agentLiveTimers.keys()]) {
    stopAgentLiveTimer(key);
  }
  setStore("agentEvents", []);
  scheduleRebuildAgentCards();
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
  scheduleRebuildAgentCards();
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
  setStore("agentCards", reconcile({}, { merge: false }));
  setStore("agentCardOrder", []);
  messageIndex.clear();
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
  changes: []
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
      setBoardStore("board", data ?? null);
      setSnapshotVersion(boardSnapshot(data));
      const lastSequence = Number(data?.lastSequence || 0);
      if (Number.isFinite(lastSequence) && lastSequence > 0) {
        setTaskSequence(lastSequence);
      }
      clearBoardRetry$1();
      setBoardUpdatedAt(Date.now());
      scheduleRebuildAgentCards();
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
function setTasksData(tasks) {
  setBoardStore("tasks", Array.isArray(tasks) ? tasks : []);
}
let boardLoadTimer = null;
function scheduleBoard(delay = 0) {
  setBoardSyncPending(true);
  clearBoardRetry$1();
  if (boardLoadTimer) {
    clearTimeout(boardLoadTimer);
    boardLoadTimer = null;
  }
  boardLoadTimer = setTimeout(() => {
    boardLoadTimer = null;
    void loadBoard({ sync: true });
  }, delay);
}
function rootTaskSessionID() {
  const sessionID = boardStore.board?.task?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}
function activeDirectory$2() {
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
const INTERRUPTABLE_STATUSES = /* @__PURE__ */ new Set([
  "queued",
  "spec_generating",
  "goal_decomposing",
  "planning",
  "planned",
  "running",
  "blocked",
  "evaluating",
  "delivering"
]);
function isTaskInterruptable() {
  const status = boardStore.board?.task?.status;
  return !!status && INTERRUPTABLE_STATUSES.has(status);
}

const board = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  activeDirectory: activeDirectory$2,
  boardStore,
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
  setTasksData,
  setVcs,
  sortedTasks,
  taskUpdated: taskUpdated$1,
  visibleTasks
}, Symbol.toStringTag, { value: 'Module' }));

var _tmpl$$i = /* @__PURE__ */ template(`<span class=tool-detail>`), _tmpl$2$g = /* @__PURE__ */ template(`<div class=msg-tool><span class=tool-icon></span><span class=tool-name></span><span class=tool-status>`), _tmpl$3$f = /* @__PURE__ */ template(`<div class=msg-tool-input>`), _tmpl$4$f = /* @__PURE__ */ template(`<div class=msg-tool-output>`), _tmpl$5$d = /* @__PURE__ */ template(`<div class=msg-tool-error>`);
function ToolPart(props) {
  const state = () => props.part.state || {};
  const status = () => state().status || "pending";
  const toolName = () => props.part.tool || "unknown";
  const input = () => state().input || {};
  const icon = () => displayToolIcon(toolName());
  const statusLabel = () => toolStatusLabel(status());
  const detail = () => {
    const raw2 = displayToolDetail(toolName(), input(), state(), activeDirectory$2());
    return raw2 && raw2.toLowerCase() !== toolName().toLowerCase() ? raw2 : "";
  };
  const raw = () => {
    const st = state();
    const r = typeof st.raw === "string" ? typeof props.part._targetRaw === "string" ? props.part._targetRaw : st.raw : "";
    return r;
  };
  const output = () => stripAnsi$1(state().output || "");
  const error = () => stripAnsi$1(state().error || "") || output();
  const expanded = () => toolOutputExpanded(props.part?.id || "");
  return [(() => {
    var _el$ = _tmpl$2$g(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$5 = _el$3.nextSibling;
    insert(_el$2, icon);
    insert(_el$3, toolName);
    insert(_el$, createComponent(Show, {
      get when() {
        return detail();
      },
      get children() {
        var _el$4 = _tmpl$$i();
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
      var _el$6 = _tmpl$3$f();
      insert(_el$6, raw);
      return _el$6;
    }
  }), createComponent(Show, {
    get when() {
      return memo(() => status() === "completed")() && output();
    },
    get children() {
      var _el$7 = _tmpl$4$f();
      _el$7.$$click = () => toggleToolOutputExpanded(props.part?.id || "");
      insert(_el$7, output);
      createRenderEffect(() => _el$7.classList.toggle("msg-tool-output--expanded", !!expanded()));
      return _el$7;
    }
  }), createComponent(Show, {
    get when() {
      return memo(() => status() === "error")() && error();
    },
    get children() {
      var _el$8 = _tmpl$5$d();
      insert(_el$8, error);
      return _el$8;
    }
  })];
}
delegateEvents(["click"]);

var _tmpl$$h = /* @__PURE__ */ template(`<div class=reasoning-text>`), _tmpl$2$f = /* @__PURE__ */ template(`<div class=msg-reasoning><div class=reasoning-label> `);
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
      var _el$ = _tmpl$2$f(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild;
      _el$2.$$click = () => setExpanded(!expanded());
      insert(_el$2, label, _el$3);
      insert(_el$2, () => expanded() ? "▼" : "▶", null);
      insert(_el$, createComponent(Show, {
        get when() {
          return expanded();
        },
        get children() {
          var _el$4 = _tmpl$$h();
          insert(_el$4, text);
          return _el$4;
        }
      }), null);
      return _el$;
    }
  });
}
delegateEvents(["click"]);

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

var _tmpl$$g = /* @__PURE__ */ template(`<article class="turn msg"><div class=msg-head><span class=msg-role></span><span class=msg-time></span></div><div class=msg-bubble><div class=msg-body>`), _tmpl$2$e = /* @__PURE__ */ template(`<div class=msg-patch>`), _tmpl$3$e = /* @__PURE__ */ template(`<div>`), _tmpl$4$e = /* @__PURE__ */ template(`<div class=msg-tool><span class=tool-icon>→</span><span class=tool-name>Subtask</span><span class=tool-detail>`);
function renderFilePart(part) {
  const url = part.url || part.filename || "";
  const name = part.filename || url || "file";
  const mime = part.mime || part.mediaType || "";
  const isImg = mime && mime.startsWith("image/") || /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
  if (isImg && url) {
    return `<div class="msg-img-wrap"><img class="md-img" src="${escapeHtml$1(url)}" alt="${escapeHtml$1(name)}" loading="lazy"></div>`;
  }
  return `<div class="msg-text" style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-soft)">${escapeHtml$1(name)}</div>`;
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
      var _el$ = _tmpl$$g(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$2.nextSibling, _el$6 = _el$5.firstChild;
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
                var _el$7 = _tmpl$2$e();
                insert(_el$7, () => "⚙ " + (part().files || []).map((f) => shortRelativePath(f, activeDirectory$2())).join(", "));
                return _el$7;
              }
            }), createComponent(Match, {
              get when() {
                return part().type === "file";
              },
              get children() {
                var _el$8 = _tmpl$3$e();
                createRenderEffect(() => _el$8.innerHTML = renderFilePart(part()));
                return _el$8;
              }
            }), createComponent(Match, {
              get when() {
                return part().type === "subtask";
              },
              get children() {
                var _el$9 = _tmpl$4$e(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling;
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

var _tmpl$$f = /* @__PURE__ */ template(`<span>`), _tmpl$2$d = /* @__PURE__ */ template(`<div class=executor-goal-body>`), _tmpl$3$d = /* @__PURE__ */ template(`<article class="turn msg executor-goal-block"data-role=executor-goal-group><div class=executor-goal-header role=button tabindex=0><span class=executor-goal-label></span><span class=executor-goal-count></span><span class=executor-goal-chevron aria-hidden=true>▼`), _tmpl$4$d = /* @__PURE__ */ template(`<span class="executor-goal-badge executor-goal-badge--running"title=Running><span class=agent-card-spinner>`);
function ExecutorGoalGroup(props) {
  const expanded = () => agentCardExpanded(props.cardID, props.status === "running");
  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, props.status === "running");
  };
  const badgeClass = () => {
    if (props.status === "running") return "executor-goal-badge executor-goal-badge--running";
    if (props.status === "error") return "executor-goal-badge executor-goal-badge--error";
    return "executor-goal-badge executor-goal-badge--done";
  };
  const badgeContent = () => {
    if (props.status === "running") return "";
    if (props.status === "error") return "✗";
    return "✓";
  };
  return (() => {
    var _el$ = _tmpl$3$d(), _el$2 = _el$.firstChild, _el$4 = _el$2.firstChild, _el$5 = _el$4.nextSibling;
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
        return _tmpl$4$d();
      },
      get children() {
        var _el$3 = _tmpl$$f();
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
    insert(_el$4, () => props.goalTitle || "Executor");
    insert(_el$5, createComponent(Show, {
      get when() {
        return props.messages.length > 0;
      },
      get children() {
        return ["(", memo(() => props.messages.length), ")"];
      }
    }));
    insert(_el$, createComponent(Show, {
      get when() {
        return expanded();
      },
      get children() {
        var _el$6 = _tmpl$2$d();
        insert(_el$6, createComponent(For, {
          get each() {
            return props.messages;
          },
          children: (msg) => createComponent(MessageView, {
            message: msg
          })
        }));
        return _el$6;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$3 = !!expanded(), _v$4 = props.cardID, _v$5 = expanded();
      _v$3 !== _p$.e && _el$.classList.toggle("executor-goal-block--expanded", _p$.e = _v$3);
      _v$4 !== _p$.t && setAttribute(_el$, "data-goal-id", _p$.t = _v$4);
      _v$5 !== _p$.a && setAttribute(_el$2, "aria-expanded", _p$.a = _v$5);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$;
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

function record$4(value) {
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
  const orchestratorRoles = ["user", "planner", "evaluator", "system"];
  if (orchestratorRoles.includes(role) && text.includes("<assistant-brief>")) {
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
  const response = record$4(interaction?.response) ? interaction.response : null;
  const payload = record$4(interaction?.payload) ? interaction.payload : null;
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (Array.isArray(response?.answers)) {
    return response.answers.flatMap((answer, index) => {
      const value = Array.isArray(answer) ? answer.filter(
        (item) => typeof item === "string" && item.trim()
      ).join(", ") : "";
      if (!value) return [];
      const question = record$4(questions[index]) ? questions[index] : null;
      const label = typeof question?.header === "string" && question.header.trim() ? question.header.trim() : typeof question?.question === "string" && question.question.trim() ? question.question.trim() : "";
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  if (record$4(response?.answers)) {
    return Object.entries(response.answers).flatMap(
      ([key, item], index) => {
        const answer = record$4(item) ? item : null;
        const value = Array.isArray(answer?.answers) ? answer.answers.filter(
          (entry) => typeof entry === "string" && entry.trim()
        ).join(", ") : "";
        if (!value) return [];
        const question = record$4(questions[index]) ? questions[index] : null;
        const label = typeof question?.header === "string" && question.header.trim() ? question.header.trim() : typeof question?.question === "string" && question.question.trim() ? question.question.trim() : key;
        return [label ? `- **${label}**: ${value}` : `- ${value}`];
      }
    );
  }
  const message = typeof response?.message === "string" ? response.message.trim() : "";
  return message ? [message] : [];
}
function isAutoReplied(interaction) {
  const response = record$4(interaction?.response) ? interaction.response : null;
  return response?.auto_reply === true;
}
function interactionResponseText(interaction) {
  const auto = isAutoReplied(interaction);
  const prefix = auto ? `[${t("interaction.auto_reply")}] ` : "";
  if (interaction?.type === "permission") {
    if (interaction.status === "rejected") return prefix + t("interaction.reject");
    const response = record$4(interaction?.response) ? interaction.response : null;
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
    msgs.push({
      _synthetic: true,
      info: { id: "ctx:user-request", role: "user", resolvedRole: "user", channel: "main", time: { created: (task.time?.created || 0) - 2 } },
      parts: [{ type: "text", text: task.request }]
    });
  }
  for (const interaction of Array.isArray(board.interactions) ? board.interactions : []) {
    const isAutoPermission = interaction.type === "permission" && (interaction.status === "answered" || interaction.status === "rejected") && isAutoReplied(interaction);
    if (isAutoPermission) continue;
    const isPlannerClarification = interaction.payload?.planner_clarification === true;
    const interactionRole = isPlannerClarification ? "planner" : "system";
    const request = syntheticTextMessage(
      interactionRole,
      interaction.time?.created || Date.now(),
      interactionRequestText(interaction)
    );
    if (request) msgs.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const response = syntheticTextMessage(
        isPlannerClarification ? "user" : "system",
        interaction.time?.resolved || interaction.time?.updated || Date.now(),
        interactionResponseText(interaction)
      );
      if (response) msgs.push(response);
    }
  }
  return msgs;
}
let _prevConversationResult = [];
let _prevConversationKey = "";
function conversationMessages() {
  const allMessages = store.messages || [];
  const rootSID = rootTaskSessionID();
  const showTranscriptDetails = store.showTranscriptDetails;
  const mainMessages = [];
  for (const msg of allMessages) {
    const channel = msg.info?.channel || classifyMessage(msg, rootSID);
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
  for (const id of Array.isArray(store.agentCardOrder) ? store.agentCardOrder : []) {
    const card = store.agentCards[id];
    if (!card) continue;
    if (card._agentGoalGroup && Array.isArray(card._agentInternalCards)) {
      const flatMsgs = [];
      for (const child of card._agentInternalCards) {
        if (Array.isArray(child._agentMessages)) {
          for (const m of child._agentMessages) {
            const live = m?.info?.id ? messageById(m.info.id) : void 0;
            if (live) flatMsgs.push(live);
          }
        }
      }
      flatMsgs.sort((a, b) => conversationTime(a) - conversationTime(b));
      agentCardMsgs.push({ ...card, _agentMessages: flatMsgs });
    } else if (Array.isArray(card._agentMessages)) {
      for (const m of card._agentMessages) {
        const live = m?.info?.id ? messageById(m.info.id) : void 0;
        if (live) agentCardMsgs.push(live);
      }
    }
  }
  const result = [...filteredMain, ...contextMsgs, ...agentCardMsgs].sort(
    (a, b) => conversationTime(a) - conversationTime(b)
  );
  const key = result.map((m) => m.info?.id || m._agentCardKey || "").join(",");
  if (key === _prevConversationKey && result.length === _prevConversationResult.length) {
    return _prevConversationResult;
  }
  _prevConversationKey = key;
  _prevConversationResult = result;
  return result;
}

var _tmpl$$e = /* @__PURE__ */ template(`<div class=chat-empty>`);
function Conversation(props) {
  const [autoScroll, setAutoScroll] = createSignal(true);
  const el = props.container;
  const items = createMemo(() => conversationMessages());
  function onScroll() {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(atBottom);
  }
  function scrollToBottom() {
    if (autoScroll()) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }
  onMount(() => {
    el.addEventListener("scroll", onScroll);
  });
  onCleanup(() => {
    el.removeEventListener("scroll", onScroll);
  });
  createEffect(() => {
    items().length;
    scrollToBottom();
  });
  const emptyText = () => t("chat.empty");
  return [createComponent(Show, {
    get when() {
      return items().length === 0;
    },
    get children() {
      var _el$ = _tmpl$$e();
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
        return createComponent(MessageView, {
          get message() {
            return item();
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
          get goalStatus() {
            return item()._agentGoalStatus;
          },
          get status() {
            return item()._agentStatus;
          },
          get messages() {
            return item()._agentMessages || [];
          }
        });
      }
    })
  })];
}

var _tmpl$$d = /* @__PURE__ */ template(`<button type=button class=task-row-delete><span class=task-row-delete-icon data-icon=delete aria-hidden=true><svg width=12 height=12 viewBox="0 0 16 16"fill=none><path d="M3.5 4.5h9"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path><path d="M6 4.5V3.6c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v.9"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path><path d="M5.2 6.2l.4 5.4c0 .5.4.9.9.9h2.9c.5 0 .9-.4.9-.9l.4-5.4"stroke=currentColor stroke-width=1.2 stroke-linecap=round>`), _tmpl$2$c = /* @__PURE__ */ template(`<div class="task-row-mini global-task-row"><button type=button class=task-row-main><div class=task-row-head><span class=status-dot aria-hidden=true></span><strong></strong></div><span></span><small>`), _tmpl$3$c = /* @__PURE__ */ template(`<section class=sidebar-list-group><div class=sidebar-list-heading></div><div class=sidebar-list-cluster>`), _tmpl$4$c = /* @__PURE__ */ template(`<div class=task-list-panel>`), _tmpl$5$c = /* @__PURE__ */ template(`<div class=empty-hint>`);
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
    planning: t("task.status.planning"),
    running: t("task.status.running"),
    blocked: t("task.status.blocked"),
    evaluating: t("task.status.evaluating"),
    delivering: t("task.status.delivering"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled")
  };
  return map[status] || status;
}
function taskListBadge(item) {
  if (item?._pending) return statusLabel$1("planning");
  const pending = Number(item?.pending_interactions || 0) > 0;
  return pending ? t("detail.pending_interactions") : statusLabel$1(item?.task?.status || "idle");
}
function taskListMeta(item) {
  return joinBullet([stamp(taskUpdated(item)), shortPath$1(item?.task?.directory || "")]);
}
function DeleteButton(props) {
  return (() => {
    var _el$ = _tmpl$$d();
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
  const status = () => pending() ? "planning" : props.item?.task?.status || "idle";
  const title = () => taskListTitle(props.item) || id();
  const isActive = () => !pending() && props.selectedTaskID === id();
  return (() => {
    var _el$2 = _tmpl$2$c(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$4.nextSibling, _el$8 = _el$7.nextSibling;
    _el$3.$$click = () => {
      if (!pending() && id()) props.onSelectTask(id());
    };
    insert(_el$6, title);
    insert(_el$7, () => taskListBadge(props.item));
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
      var _el$9 = _tmpl$3$c(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
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
  const selectedID = () => boardStore.selectedTaskID;
  return (() => {
    var _el$10 = _tmpl$4$c();
    insert(_el$10, createComponent(Show, {
      get when() {
        return sortedItems().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$11 = _tmpl$5$c();
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

var _tmpl$2$b = /* @__PURE__ */ template(`<div class=plan-version>`), _tmpl$3$b = /* @__PURE__ */ template(`<div class="plan-version streaming-indicator">`), _tmpl$4$b = /* @__PURE__ */ template(`<p class=empty-hint>`), _tmpl$5$b = /* @__PURE__ */ template(`<div class="plan-summary md-content">`), _tmpl$6$a = /* @__PURE__ */ template(`<div class=goals-list>`), _tmpl$7$9 = /* @__PURE__ */ template(`<span class=extension-status data-state=passed>✓`), _tmpl$8$6 = /* @__PURE__ */ template(`<span class=extension-status data-state=failed>✗`), _tmpl$9$5 = /* @__PURE__ */ template(`<span class=extension-status data-state=active>`), _tmpl$0$3 = /* @__PURE__ */ template(`<div class="goal-criteria md-content">`), _tmpl$1$2 = /* @__PURE__ */ template(`<details class=goal-item><summary class=goal-item-head><span class=goal-item-chevron aria-hidden=true>▶</span><span class=goal-desc-inline></span><span class=goal-title-brief></span></summary><div class=goal-item-body><div class=goal-content><div class=plan-version></div><div class="goal-desc md-content">`), _tmpl$10$1 = /* @__PURE__ */ template(`<span class=goal-priority>`), _tmpl$11$1 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini"data-goal-action=view-session title="View executor session"aria-label="View executor session">View`), _tmpl$12$1 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini"data-goal-action=edit>`), _tmpl$13$1 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini danger"data-goal-action=delete>`), _tmpl$14$1 = /* @__PURE__ */ template(`<div class=goal-actions>`), _tmpl$15$1 = /* @__PURE__ */ template(`<details class=goal-item><summary class=goal-item-head><span class=goal-item-chevron aria-hidden=true>▶</span><span class=goal-desc-inline></span><span class=goal-title-brief></span></summary><div class=goal-item-body><div class=goal-content><div class="goal-desc md-content">`), _tmpl$16$1 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$17 = /* @__PURE__ */ template(`<section class=criteria-group><div class=criteria-group-head><span class=criteria-group-icon aria-hidden=true></span><div class=criteria-group-title></div><div class=criteria-group-count></div></div><div class=criteria-group-list>`), _tmpl$18 = /* @__PURE__ */ template(`<label class=criteria-item><input type=checkbox><span class=check-mark></span><span class=criteria-copy><span class=criteria-name></span><span class=criteria-desc></span></span><span class=criteria-status></span><span class=criteria-result>`), _tmpl$19 = /* @__PURE__ */ template(`<div class="eval-summary md-content">`), _tmpl$20 = /* @__PURE__ */ template(`<div class=eval-error-meta>`), _tmpl$21 = /* @__PURE__ */ template(`<div class=eval-error><div class=eval-error-name>✗ </div><div class="eval-error-detail md-content">`), _tmpl$22 = /* @__PURE__ */ template(`<div class=delivery-files>`), _tmpl$23 = /* @__PURE__ */ template(`<div class=delivery-card><div class=delivery-title></div><div class="delivery-summary md-content">`), _tmpl$24 = /* @__PURE__ */ template(`<button type=button class="btn btn-primary"data-task-action=retry>`), _tmpl$25 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost"data-task-action=replan>`), _tmpl$26 = /* @__PURE__ */ template(`<div class=task-actions-buttons>`), _tmpl$27 = /* @__PURE__ */ template(`<div class=task-actions-bar>`), _tmpl$28 = /* @__PURE__ */ template(`<button class="btn btn-primary"data-action=always>`), _tmpl$29 = /* @__PURE__ */ template(`<button class="btn btn-ghost"data-action=once>`), _tmpl$30 = /* @__PURE__ */ template(`<button class="btn btn-ghost"data-action=reject>`), _tmpl$31 = /* @__PURE__ */ template(`<div class=interaction-alert><div class=interaction-title> </div><div class="interaction-body md-content"></div><div class=interaction-actions>`), _tmpl$32 = /* @__PURE__ */ template(`<button class="btn btn-primary"data-action=answer>`), _tmpl$33 = /* @__PURE__ */ template(`<div class=interactions-list>`), _tmpl$36 = /* @__PURE__ */ template(`<details class=section><summary class=section-head><span class=section-icon aria-hidden=true></span><span class=section-title></span><span class=section-badge></span></summary><div class=section-body>`), _tmpl$37 = /* @__PURE__ */ template(`<div id=taskActionsBar>`);
function statusIcon(status) {
  const map = {
    idle: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><circle data-fill="true" cx="8" cy="8" r="1.25"/></svg>`,
    queued: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M8 5.4v2.8l2.1 1.3"/></svg>`,
    planning: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-stroke="true" d="M5 3.5v9"/><path data-stroke="true" d="M5 5.5h6"/><path data-stroke="true" d="M5 10.5h4"/><circle data-fill="true" cx="5" cy="3.5" r="1.15"/><circle data-fill="true" cx="11" cy="5.5" r="1.15"/><circle data-fill="true" cx="9" cy="10.5" r="1.15"/></svg>`,
    running: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M6 4.6L11.3 8 6 11.4Z"/></svg>`,
    blocked: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M8 3.1L13 12H3Z"/><path data-stroke="true" d="M8 5.8v2.8"/><circle data-fill="true" cx="8" cy="10.8" r="0.9" style="fill: var(--surface-strong);"/></svg>`,
    evaluating: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="6.7" cy="6.7" r="3.5"/><path data-stroke="true" d="M9.5 9.5l2.9 2.9"/><circle data-fill="true" cx="6.7" cy="6.7" r="1.2"/></svg>`,
    delivering: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-stroke="true" d="M3.5 8h9"/><path data-stroke="true" d="M9 4.5L12.5 8 9 11.5"/><circle data-fill="true" cx="3.5" cy="8" r="1"/></svg>`,
    completed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.1 8.2l2 2 3.8-3.8"/></svg>`,
    failed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.4 5.4l5.2 5.2"/><path data-stroke="true" d="M10.6 5.4l-5.2 5.2"/></svg>`,
    cancelled: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.2 10.8l5.6-5.6"/></svg>`
  };
  return map[status] || map.idle;
}
function SpecPanel(props) {
  const content = () => props.spec?.content || props.preview || "";
  const isPreview = () => !props.spec?.content && !!props.preview;
  return createComponent(Show, {
    get when() {
      return content();
    },
    get fallback() {
      return (() => {
        var _el$6 = _tmpl$4$b();
        insert(_el$6, () => t("empty.spec"));
        return _el$6;
      })();
    },
    get children() {
      return [createComponent(TextPart, {
        get text() {
          return content();
        }
      }), createComponent(Show, {
        get when() {
          return !isPreview();
        },
        get children() {
          var _el$4 = _tmpl$2$b();
          insert(_el$4, () => stamp(props.spec?.time?.created));
          return _el$4;
        }
      }), createComponent(Show, {
        get when() {
          return isPreview();
        },
        get children() {
          var _el$5 = _tmpl$3$b();
          insert(_el$5, () => t("common.generating") || "Generating...");
          return _el$5;
        }
      })];
    }
  });
}
function PlanPanel(props) {
  const isPreview = () => !props.plan?.prompt && !props.plan?.summary && !!props.preview;
  const hasPlan = () => !!props.plan?.prompt || !!props.plan?.summary;
  const activeGoals = createMemo(() => {
    const cards = props.goalCards || [];
    const running = props.runningGoalIDs;
    if (!running || running.size === 0) return [];
    return cards.map((card, idx) => ({
      ...card,
      goalIndex: idx + 1
    })).filter((card) => running.has(card.id));
  });
  const allGoals = createMemo(() => {
    const cards = props.goalCards || [];
    return cards.map((card, idx) => ({
      ...card,
      goalIndex: idx + 1
    }));
  });
  const displayGoals = () => activeGoals().length > 0 ? activeGoals() : allGoals();
  const version = () => props.plan?.version;
  return [createComponent(Show, {
    get when() {
      return isPreview();
    },
    get children() {
      var _el$7 = _tmpl$3$b();
      insert(_el$7, () => t("common.generating") || "Generating...");
      return _el$7;
    }
  }), createComponent(Show, {
    get when() {
      return !isPreview();
    },
    get children() {
      return [createComponent(Show, {
        get when() {
          return memo(() => !!hasPlan())() && props.plan?.summary;
        },
        get children() {
          var _el$8 = _tmpl$5$b();
          createRenderEffect(() => _el$8.innerHTML = renderMarkdown$1(props.plan.summary));
          return _el$8;
        }
      }), createComponent(Show, {
        get when() {
          return displayGoals().length > 0;
        },
        get fallback() {
          return createComponent(Show, {
            get when() {
              return !hasPlan();
            },
            get children() {
              var _el$0 = _tmpl$4$b();
              insert(_el$0, () => t("empty.plan"));
              return _el$0;
            }
          });
        },
        get children() {
          var _el$9 = _tmpl$6$a();
          insert(_el$9, createComponent(For, {
            get each() {
              return displayGoals();
            },
            children: (goal) => {
              const isRunning = () => props.runningGoalIDs?.has(goal.id);
              const goalStatus = () => goal.status || (isRunning() ? "running" : "pending");
              const shortTitle = () => {
                const raw = goal.title || "";
                const first = raw.split("\n")[0].replace(/^#+\s*/, "").trim();
                return first.length > 60 ? first.slice(0, 57) + "..." : first;
              };
              return (() => {
                var _el$1 = _tmpl$1$2(), _el$10 = _el$1.firstChild, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$12.nextSibling, _el$17 = _el$10.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling;
                insert(_el$12, () => `Goal#${goal.goalIndex}`);
                insert(_el$13, shortTitle);
                insert(_el$10, createComponent(Show, {
                  get when() {
                    return goalStatus() === "passed";
                  },
                  get children() {
                    return _tmpl$7$9();
                  }
                }), null);
                insert(_el$10, createComponent(Show, {
                  get when() {
                    return goalStatus() === "failed";
                  },
                  get children() {
                    return _tmpl$8$6();
                  }
                }), null);
                insert(_el$10, createComponent(Show, {
                  get when() {
                    return isRunning();
                  },
                  get children() {
                    var _el$16 = _tmpl$9$5();
                    insert(_el$16, () => t("goal.running"));
                    return _el$16;
                  }
                }), null);
                insert(_el$19, () => `Plan V${version()}`);
                insert(_el$18, createComponent(Show, {
                  get when() {
                    return goal.detail;
                  },
                  get children() {
                    var _el$21 = _tmpl$0$3();
                    createRenderEffect(() => _el$21.innerHTML = renderMarkdown$1(goal.detail));
                    return _el$21;
                  }
                }), null);
                createRenderEffect(() => _el$20.innerHTML = renderMarkdown$1(goal.title || ""));
                return _el$1;
              })();
            }
          }));
          return _el$9;
        }
      })];
    }
  })];
}
function GoalsPanel(props) {
  createMemo(() => (props.cards || []).filter((c) => c.status === "passed").length);
  const total = createMemo(() => (props.cards || []).length);
  return createComponent(Show, {
    get when() {
      return total() > 0;
    },
    get fallback() {
      return (() => {
        var _el$23 = _tmpl$4$b();
        insert(_el$23, () => t("empty.goals"));
        return _el$23;
      })();
    },
    get children() {
      var _el$22 = _tmpl$6$a();
      insert(_el$22, createComponent(For, {
        get each() {
          return props.cards;
        },
        children: (card, idx) => (() => {
          var _el$24 = _tmpl$15$1(), _el$25 = _el$24.firstChild, _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$28 = _el$27.nextSibling, _el$31 = _el$25.nextSibling, _el$32 = _el$31.firstChild, _el$33 = _el$32.firstChild;
          insert(_el$27, () => `Goal#${idx() + 1}`);
          insert(_el$28, () => {
            const raw = card.title || "";
            const first = raw.split("\n")[0].replace(/^#+\s*/, "").trim();
            return first.length > 50 ? first.slice(0, 47) + "..." : first;
          });
          insert(_el$25, createComponent(Show, {
            get when() {
              return props.runningGoalIDs.has(card.id);
            },
            get children() {
              var _el$29 = _tmpl$9$5();
              insert(_el$29, () => t("goal.running"));
              return _el$29;
            }
          }), null);
          insert(_el$25, createComponent(Show, {
            get when() {
              return card.metadata?.priority;
            },
            get children() {
              var _el$30 = _tmpl$10$1();
              insert(_el$30, () => card.metadata.priority);
              createRenderEffect(() => setAttribute(_el$30, "data-priority", card.metadata.priority));
              return _el$30;
            }
          }), null);
          insert(_el$32, createComponent(Show, {
            get when() {
              return card.detail;
            },
            get children() {
              var _el$34 = _tmpl$0$3();
              createRenderEffect(() => _el$34.innerHTML = renderMarkdown$1(card.detail));
              return _el$34;
            }
          }), null);
          insert(_el$31, createComponent(Show, {
            get when() {
              return memo(() => !!props.onOpenSession)() && card.metadata?.sessionID;
            },
            get children() {
              var _el$35 = _tmpl$11$1();
              _el$35.$$click = () => props.onOpenSession?.(card.metadata.sessionID, card.title || card.id);
              createRenderEffect(() => setAttribute(_el$35, "data-goal-id", card.id));
              return _el$35;
            }
          }), null);
          insert(_el$31, createComponent(Show, {
            get when() {
              return props.onEditGoal || props.onDeleteGoal;
            },
            get children() {
              var _el$36 = _tmpl$14$1();
              insert(_el$36, createComponent(Show, {
                get when() {
                  return props.onEditGoal;
                },
                get children() {
                  var _el$37 = _tmpl$12$1();
                  _el$37.$$click = () => props.onEditGoal?.(card.id, card.title, card.detail || "");
                  insert(_el$37, () => t("common.edit"));
                  createRenderEffect((_p$) => {
                    var _v$4 = card.id, _v$5 = t("goal.edit_button_title"), _v$6 = t("goal.edit_button_title");
                    _v$4 !== _p$.e && setAttribute(_el$37, "data-goal-id", _p$.e = _v$4);
                    _v$5 !== _p$.t && setAttribute(_el$37, "title", _p$.t = _v$5);
                    _v$6 !== _p$.a && setAttribute(_el$37, "aria-label", _p$.a = _v$6);
                    return _p$;
                  }, {
                    e: void 0,
                    t: void 0,
                    a: void 0
                  });
                  return _el$37;
                }
              }), null);
              insert(_el$36, createComponent(Show, {
                get when() {
                  return props.onDeleteGoal;
                },
                get children() {
                  var _el$38 = _tmpl$13$1();
                  _el$38.$$click = () => props.onDeleteGoal?.(card.id);
                  insert(_el$38, () => t("common.delete"));
                  createRenderEffect((_p$) => {
                    var _v$7 = card.id, _v$8 = t("goal.delete_button_title"), _v$9 = t("goal.delete_button_title");
                    _v$7 !== _p$.e && setAttribute(_el$38, "data-goal-id", _p$.e = _v$7);
                    _v$8 !== _p$.t && setAttribute(_el$38, "title", _p$.t = _v$8);
                    _v$9 !== _p$.a && setAttribute(_el$38, "aria-label", _p$.a = _v$9);
                    return _p$;
                  }, {
                    e: void 0,
                    t: void 0,
                    a: void 0
                  });
                  return _el$38;
                }
              }), null);
              return _el$36;
            }
          }), null);
          createRenderEffect(() => _el$33.innerHTML = renderMarkdown$1(card.title || ""));
          return _el$24;
        })()
      }));
      return _el$22;
    }
  });
}
const COMMAND_CHECKS = [{
  key: "build",
  label: "Build",
  kind: "command",
  family: "build"
}, {
  key: "test",
  label: "Unit Tests",
  kind: "command",
  family: "test"
}, {
  key: "lint",
  label: "Lint",
  kind: "command",
  family: "lint"
}, {
  key: "verify_cmd",
  label: "Verify Command",
  kind: "command",
  family: "verify_cmd"
}];
const TOGGLE_CHECKS = [{
  key: "startup",
  label: "Startup",
  kind: "toggle",
  family: "runtime"
}, {
  key: "artifact",
  label: "Artifacts",
  kind: "toggle",
  family: "artifact"
}, {
  key: "visual",
  label: "Visual Check",
  kind: "toggle",
  family: "runtime"
}, {
  key: "puppeteer",
  label: "Puppeteer",
  kind: "toggle",
  family: "runtime"
}, {
  key: "ui_review",
  label: "UI Review",
  kind: "toggle",
  family: "review"
}, {
  key: "code_quality",
  label: "Code Quality",
  kind: "toggle",
  family: "review"
}, {
  key: "code_review",
  label: "Code Review",
  kind: "toggle",
  family: "review"
}, {
  key: "dead_code_review",
  label: "Dead Code Review",
  kind: "toggle",
  family: "review"
}, {
  key: "spec_check",
  label: "Spec Check",
  kind: "toggle",
  family: "acceptance"
}];
const CHECK_FAMILIES = [{
  key: "command",
  order: 0
}, {
  key: "runtime",
  order: 1
}, {
  key: "artifact",
  order: 2
}, {
  key: "review",
  order: 3
}, {
  key: "acceptance",
  order: 4
}, {
  key: "custom",
  order: 5
}];
function normalizeCheckName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_#:-]/g, "_");
}
function baseCheckName(value) {
  return normalizeCheckName(value).replace(/#\d+$/, "");
}
function checkLabel(key) {
  const known = {
    build: t("checks.build"),
    test: t("checks.test"),
    lint: t("checks.lint"),
    verify_cmd: t("checks.verify_cmd"),
    py_compile: t("checks.py_compile"),
    pytest: t("checks.pytest"),
    typecheck: t("checks.typecheck"),
    ruff: t("checks.ruff"),
    mypy: t("checks.mypy"),
    startup: t("checks.startup"),
    artifact: t("checks.artifact"),
    visual: t("checks.visual"),
    puppeteer: t("checks.puppeteer"),
    ui_review: t("checks.ui_review"),
    code_quality: t("checks.code_quality"),
    code_review: t("checks.code_review"),
    dead_code_review: t("checks.dead_code_review"),
    spec_check: t("checks.spec_check")
  };
  if (known[key]) return known[key];
  return key.split(/[_-]+/).filter(Boolean).map((item) => (item[0]?.toUpperCase() ?? "") + item.slice(1)).join(" ");
}
function checkFamilyKey(family, name) {
  const base = baseCheckName(name);
  if (["build", "test", "lint", "verify_cmd"].includes(family) || ["build", "test", "lint", "verify_cmd"].includes(base)) {
    return "command";
  }
  if (["runtime", "artifact", "review", "acceptance", "custom"].includes(family)) return family;
  if (["startup", "visual", "puppeteer"].includes(base)) return "runtime";
  if (base === "artifact") return "artifact";
  if (["ui_review", "code_quality", "code_review", "dead_code_review"].includes(base)) return "review";
  if (base === "spec_check") return "acceptance";
  return "custom";
}
function checkFamilyText(key) {
  if (key === "command") return t("checks.family.command");
  if (key === "runtime") return t("checks.family.runtime");
  if (key === "artifact") return t("checks.family.artifact");
  if (key === "review") return t("checks.family.review");
  if (key === "acceptance") return t("checks.family.acceptance");
  return t("checks.family.custom");
}
const CHECK_FAMILY_ICONS = {
  command: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="10" height="9" rx="1.2"/><polyline points="4.5,6 6,7.5 4.5,9"/><line x1="7.5" y1="9" x2="9.5" y2="9"/></svg>`,
  runtime: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.5L9.5 7 4.5 10.5Z"/></svg>`,
  artifact: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5L7 2l4.5 2.5v5L7 12l-4.5-2.5Z"/><polyline points="2.5,4.5 7,7 11.5,4.5"/><line x1="7" y1="7" x2="7" y2="12"/></svg>`,
  review: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.2" cy="6.2" r="3.5"/><line x1="9" y1="9" x2="11.5" y2="11.5"/></svg>`,
  acceptance: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="1.5" width="9" height="11" rx="1.2"/><polyline points="5,6.5 6.5,8 9,5.5"/><line x1="5" y1="10" x2="9" y2="10"/></svg>`,
  custom: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="1"/><path d="M6.1 2.5l-.2 1.2a3.4 3.4 0 0 0-.9.5L3.8 3.8l-.9.9.4 1.2a3.4 3.4 0 0 0-.5.9l-1.2.2v1.2l1.2.2c.1.3.3.6.5.9l-.4 1.2.9.9 1.2-.4c.3.2.6.4.9.5l.2 1.2h1.2l.2-1.2c.3-.1.6-.3.9-.5l1.2.4.9-.9-.4-1.2c.2-.3.4-.6.5-.9l1.2-.2V6.8l-1.2-.2a3.4 3.4 0 0 0-.5-.9l.4-1.2-.9-.9-1.2.4a3.4 3.4 0 0 0-.9-.5L7.9 2.5Z"/></svg>`
};
function record$3(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function aggregateCheckStatus(checks, key) {
  const matches = (Array.isArray(checks) ? checks : []).filter((item) => baseCheckName(item.name || item.label) === key);
  if (matches.length === 0) return "pending";
  if (matches.some((item) => item.status === "failed")) return "failed";
  if (matches.some((item) => item.status === "passed")) return "passed";
  if (matches.every((item) => item.status === "skipped")) return "skipped";
  return "pending";
}
function criteriaEnabledValue(key, value, fallback) {
  if (["build", "test", "lint", "verify_cmd"].includes(key)) {
    return value !== false && (value !== void 0 || fallback);
  }
  if (key === "spec_check" && value === void 0) return true;
  if (value === true) return true;
  if (!value || !record$3(value)) return false;
  return value.enabled !== false;
}
function criteriaSpecs(task, evaluation) {
  const checksConfig = task?.metadata?.checks;
  const config = checksConfig && record$3(checksConfig) ? {
    ...checksConfig
  } : {};
  const named = config.named && record$3(config.named) ? config.named : {};
  const seen = /* @__PURE__ */ new Set();
  const specs = [];
  const showDefault = Object.keys(config).length === 0 && (!evaluation?.checks || evaluation.checks.length === 0);
  const push = (spec) => {
    if (seen.has(spec.key)) return;
    seen.add(spec.key);
    specs.push(spec);
  };
  for (const item of COMMAND_CHECKS) {
    const value = config[item.key];
    const visible = value !== void 0 || aggregateCheckStatus(evaluation?.checks, item.key) !== "pending" || showDefault && ["build", "test", "lint"].includes(item.key);
    if (!visible) continue;
    push({
      key: item.key,
      name: item.key,
      label: checkLabel(item.key),
      kind: item.kind,
      family: item.family,
      group: checkFamilyKey(item.family, item.key),
      enabled: criteriaEnabledValue(item.key, value, showDefault),
      readOnly: false
    });
  }
  for (const item of TOGGLE_CHECKS) {
    const value = config[item.key];
    const canToggle = ["artifact", "ui_review", "code_quality", "code_review", "dead_code_review", "spec_check"].includes(item.key);
    const visible = value !== void 0 || aggregateCheckStatus(evaluation?.checks, item.key) !== "pending" || canToggle;
    if (!visible) continue;
    push({
      key: item.key,
      name: item.key,
      label: checkLabel(item.key),
      kind: item.kind,
      family: item.family,
      group: checkFamilyKey(item.family, item.key),
      enabled: criteriaEnabledValue(item.key, value, false),
      readOnly: false
    });
  }
  for (const [key, value] of Object.entries(named)) {
    if (!value || !record$3(value)) continue;
    push({
      key: `named:${key}`,
      name: key,
      label: value.label || checkLabel(key),
      kind: "named",
      family: value.family || void 0,
      group: checkFamilyKey(value.family || "", key),
      enabled: value.enabled !== false,
      readOnly: false
    });
  }
  for (const check of evaluation?.checks || []) {
    const key = baseCheckName(check.name || check.label);
    if (!key) continue;
    if (seen.has(key) || seen.has(`named:${key}`)) continue;
    push({
      key,
      name: key,
      label: check.label || checkLabel(key),
      kind: "named",
      family: check.family || void 0,
      group: checkFamilyKey(check.family || "", key),
      enabled: true,
      readOnly: true
    });
  }
  return specs;
}
function groupChecks(items) {
  const groups = /* @__PURE__ */ new Map();
  const order = new Map(CHECK_FAMILIES.map((item) => [item.key, item.order]));
  for (const item of items) {
    const key = item.group || "custom";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: checkFamilyText(key),
        items: []
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}
function criteriaResultText(status) {
  if (status === "off") return t("checks.off");
  if (status === "passed") return t("checks.pass");
  if (status === "failed") return t("checks.fail");
  if (status === "skipped") return t("checks.skip");
  return t("checks.pending");
}
function CriteriaPanel(props) {
  const specs = createMemo(() => criteriaSpecs(props.task, props.evaluation));
  const groups = createMemo(() => groupChecks(specs()));
  const checkStatuses = createMemo(() => {
    const result = {};
    for (const spec of specs()) {
      const status = spec.enabled ? aggregateCheckStatus(props.evaluation?.checks, spec.name) : "off";
      result[spec.key] = status;
    }
    return result;
  });
  return createComponent(Show, {
    get when() {
      return specs().length > 0;
    },
    get fallback() {
      return (() => {
        var _el$39 = _tmpl$16$1();
        insert(_el$39, () => t("empty.checks"));
        return _el$39;
      })();
    },
    get children() {
      return createComponent(For, {
        get each() {
          return groups();
        },
        children: (group) => (() => {
          var _el$40 = _tmpl$17(), _el$41 = _el$40.firstChild, _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling, _el$44 = _el$43.nextSibling, _el$45 = _el$41.nextSibling;
          insert(_el$43, () => group.label);
          insert(_el$44, () => tc("checks.group_count", group.items.length, {
            count: group.items.length
          }));
          insert(_el$45, createComponent(For, {
            get each() {
              return group.items;
            },
            children: (spec) => {
              const status = () => checkStatuses()[spec.key] || "pending";
              return (() => {
                var _el$46 = _tmpl$18(), _el$47 = _el$46.firstChild, _el$48 = _el$47.nextSibling, _el$49 = _el$48.nextSibling, _el$50 = _el$49.firstChild, _el$51 = _el$50.nextSibling, _el$52 = _el$49.nextSibling, _el$53 = _el$52.nextSibling;
                _el$47.addEventListener("change", (e) => props.onToggle?.(spec.key, e.currentTarget.checked));
                insert(_el$50, () => spec.label);
                insert(_el$51, (() => {
                  var _c$ = memo(() => !!spec.readOnly);
                  return () => _c$() ? t("detail.observed") : memo(() => !!spec.enabled)() ? t("detail.enabled") : t("detail.disabled");
                })());
                insert(_el$53, () => criteriaResultText(status()));
                createRenderEffect((_p$) => {
                  var _v$10 = spec.readOnly ? "true" : void 0, _v$11 = spec.key, _v$12 = spec.readOnly, _v$13 = status();
                  _v$10 !== _p$.e && setAttribute(_el$46, "data-readonly", _p$.e = _v$10);
                  _v$11 !== _p$.t && setAttribute(_el$47, "data-check", _p$.t = _v$11);
                  _v$12 !== _p$.a && (_el$47.disabled = _p$.a = _v$12);
                  _v$13 !== _p$.o && setAttribute(_el$52, "data-result", _p$.o = _v$13);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0,
                  o: void 0
                });
                createRenderEffect(() => _el$47.checked = spec.enabled);
                return _el$46;
              })();
            }
          }));
          createRenderEffect((_p$) => {
            var _v$0 = group.key, _v$1 = CHECK_FAMILY_ICONS[group.key] || "";
            _v$0 !== _p$.e && setAttribute(_el$40, "data-family", _p$.e = _v$0);
            _v$1 !== _p$.t && (_el$42.innerHTML = _p$.t = _v$1);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$40;
        })()
      });
    }
  });
}
function checkFamilyLabel(family, name) {
  return checkFamilyText(checkFamilyKey(family, name));
}
function EvaluationPanel(props) {
  const errors = createMemo(() => {
    const result = [];
    for (const check of props.evaluation?.checks || []) {
      if (check.status === "failed" && check.evidence) {
        result.push({
          name: check.label || checkLabel(baseCheckName(check.name || check.label)),
          family: checkFamilyLabel(check.family || "", check.name || check.label || ""),
          evidence: check.evidence
        });
      }
    }
    return result;
  });
  return createComponent(Show, {
    get when() {
      return props.evaluation;
    },
    get children() {
      return [createComponent(For, {
        get each() {
          return errors();
        },
        children: (err) => (() => {
          var _el$55 = _tmpl$21(), _el$56 = _el$55.firstChild; _el$56.firstChild; var _el$60 = _el$56.nextSibling;
          insert(_el$56, () => err.name, null);
          insert(_el$55, createComponent(Show, {
            get when() {
              return err.family;
            },
            get children() {
              var _el$59 = _tmpl$20();
              insert(_el$59, () => err.family);
              return _el$59;
            }
          }), _el$60);
          createRenderEffect(() => _el$60.innerHTML = renderMarkdown$1(err.evidence.slice(0, 400)));
          return _el$55;
        })()
      }), createComponent(Show, {
        get when() {
          return props.evaluation?.summary;
        },
        get children() {
          var _el$54 = _tmpl$19();
          createRenderEffect(() => _el$54.innerHTML = renderMarkdown$1(props.evaluation.summary));
          return _el$54;
        }
      })];
    }
  });
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
        var _el$65 = _tmpl$4$b();
        insert(_el$65, () => t("empty.delivery"));
        return _el$65;
      })();
    },
    get children() {
      var _el$61 = _tmpl$23(), _el$62 = _el$61.firstChild, _el$63 = _el$62.nextSibling;
      insert(_el$62, () => deliveryStatusLabel(props.delivery?.status));
      insert(_el$61, createComponent(Show, {
        get when() {
          return props.delivery?.result?.changedFiles?.length > 0;
        },
        get children() {
          var _el$64 = _tmpl$22();
          insert(_el$64, () => tc("delivery.files_changed", props.delivery.result.changedFiles.length, {
            count: props.delivery.result.changedFiles.length
          }));
          return _el$64;
        }
      }), null);
      createRenderEffect(() => _el$63.innerHTML = renderMarkdown$1(props.delivery?.summary || props.delivery?.result?.summary || ""));
      return _el$61;
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
      var _el$66 = _tmpl$27();
      insert(_el$66, createComponent(Show, {
        get when() {
          return hasButtons();
        },
        get children() {
          var _el$67 = _tmpl$26();
          insert(_el$67, createComponent(Show, {
            get when() {
              return controls().canRetry;
            },
            get children() {
              var _el$68 = _tmpl$24();
              _el$68.$$click = () => props.onRetry?.();
              insert(_el$68, () => t("task.action.retry"));
              createRenderEffect((_p$) => {
                var _v$14 = t("task.action.retry_title"), _v$15 = t("task.action.retry_title");
                _v$14 !== _p$.e && setAttribute(_el$68, "title", _p$.e = _v$14);
                _v$15 !== _p$.t && setAttribute(_el$68, "aria-label", _p$.t = _v$15);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$68;
            }
          }), null);
          insert(_el$67, createComponent(Show, {
            get when() {
              return controls().canReplan;
            },
            get children() {
              var _el$69 = _tmpl$25();
              _el$69.$$click = () => props.onReplan?.();
              insert(_el$69, () => t("task.action.replan"));
              createRenderEffect((_p$) => {
                var _v$16 = t("task.action.replan_title"), _v$17 = t("task.action.replan_title");
                _v$16 !== _p$.e && setAttribute(_el$69, "title", _p$.e = _v$16);
                _v$17 !== _p$.t && setAttribute(_el$69, "aria-label", _p$.t = _v$17);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$69;
            }
          }), null);
          return _el$67;
        }
      }));
      return _el$66;
    }
  });
}
function interactionIcon$1(interaction) {
  return interaction.type === "permission" ? "🔒" : "❓";
}
function InteractionAlert(props) {
  const icon = () => interactionIcon$1(props.interaction);
  return (() => {
    var _el$70 = _tmpl$31(), _el$71 = _el$70.firstChild, _el$72 = _el$71.firstChild, _el$73 = _el$71.nextSibling, _el$74 = _el$73.nextSibling;
    insert(_el$71, icon, _el$72);
    insert(_el$71, () => props.interaction.title, null);
    insert(_el$74, createComponent(Show, {
      get when() {
        return props.interaction.type === "permission";
      },
      get fallback() {
        return [(() => {
          var _el$78 = _tmpl$32();
          _el$78.$$click = () => props.onResolve?.(props.interaction.id, "answer");
          insert(_el$78, () => t("interaction.answer"));
          createRenderEffect((_p$) => {
            var _v$26 = t("interaction.answer_title"), _v$27 = t("interaction.answer_title");
            _v$26 !== _p$.e && setAttribute(_el$78, "title", _p$.e = _v$26);
            _v$27 !== _p$.t && setAttribute(_el$78, "aria-label", _p$.t = _v$27);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$78;
        })(), (() => {
          var _el$79 = _tmpl$30();
          _el$79.$$click = () => props.onReject?.(props.interaction.id);
          insert(_el$79, () => t("interaction.skip"));
          createRenderEffect((_p$) => {
            var _v$28 = t("interaction.skip_title"), _v$29 = t("interaction.skip_title");
            _v$28 !== _p$.e && setAttribute(_el$79, "title", _p$.e = _v$28);
            _v$29 !== _p$.t && setAttribute(_el$79, "aria-label", _p$.t = _v$29);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$79;
        })()];
      },
      get children() {
        return [(() => {
          var _el$75 = _tmpl$28();
          _el$75.$$click = () => props.onResolve?.(props.interaction.id, "always");
          insert(_el$75, () => t("interaction.always_allow"));
          createRenderEffect((_p$) => {
            var _v$18 = t("interaction.always_allow_title"), _v$19 = t("interaction.always_allow_title");
            _v$18 !== _p$.e && setAttribute(_el$75, "title", _p$.e = _v$18);
            _v$19 !== _p$.t && setAttribute(_el$75, "aria-label", _p$.t = _v$19);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$75;
        })(), (() => {
          var _el$76 = _tmpl$29();
          _el$76.$$click = () => props.onResolve?.(props.interaction.id, "once");
          insert(_el$76, () => t("interaction.allow_once"));
          createRenderEffect((_p$) => {
            var _v$20 = t("interaction.allow_once_title"), _v$21 = t("interaction.allow_once_title");
            _v$20 !== _p$.e && setAttribute(_el$76, "title", _p$.e = _v$20);
            _v$21 !== _p$.t && setAttribute(_el$76, "aria-label", _p$.t = _v$21);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$76;
        })(), (() => {
          var _el$77 = _tmpl$30();
          _el$77.$$click = () => props.onReject?.(props.interaction.id);
          insert(_el$77, () => t("interaction.reject"));
          createRenderEffect((_p$) => {
            var _v$22 = t("interaction.reject_title"), _v$23 = t("interaction.reject_title");
            _v$22 !== _p$.e && setAttribute(_el$77, "title", _p$.e = _v$22);
            _v$23 !== _p$.t && setAttribute(_el$77, "aria-label", _p$.t = _v$23);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$77;
        })()];
      }
    }));
    createRenderEffect((_p$) => {
      var _v$24 = props.interaction.id, _v$25 = renderMarkdown$1(props.interaction.body || "");
      _v$24 !== _p$.e && setAttribute(_el$70, "data-id", _p$.e = _v$24);
      _v$25 !== _p$.t && (_el$73.innerHTML = _p$.t = _v$25);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$70;
  })();
}
function InteractionsList(props) {
  const pending = createMemo(() => (props.interactions || []).filter((item) => item.status === "pending"));
  return createComponent(Show, {
    get when() {
      return pending().length > 0;
    },
    get children() {
      var _el$80 = _tmpl$33();
      insert(_el$80, createComponent(For, {
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
      return _el$80;
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
    var _el$84 = _tmpl$36(), _el$85 = _el$84.firstChild, _el$86 = _el$85.firstChild, _el$87 = _el$86.nextSibling, _el$88 = _el$87.nextSibling, _el$89 = _el$85.nextSibling;
    insert(_el$87, () => props.title);
    insert(_el$88, () => props.badgeText || "");
    insert(_el$89, () => props.children);
    createRenderEffect((_p$) => {
      var _v$30 = props.id, _v$31 = props.icon || "", _v$32 = props.badgeId, _v$33 = props.badgeTone, _v$34 = props.bodyId;
      _v$30 !== _p$.e && setAttribute(_el$84, "id", _p$.e = _v$30);
      _v$31 !== _p$.t && (_el$86.innerHTML = _p$.t = _v$31);
      _v$32 !== _p$.a && setAttribute(_el$88, "id", _p$.a = _v$32);
      _v$33 !== _p$.o && setAttribute(_el$88, "data-tone", _p$.o = _v$33);
      _v$34 !== _p$.i && setAttribute(_el$89, "id", _p$.i = _v$34);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    return _el$84;
  })();
}
function Board(props) {
  const board = () => boardStore.board;
  const task = () => board()?.task;
  const plan = () => board()?.plan;
  const spec = () => board()?.spec;
  const evaluation = () => board()?.evaluation;
  const delivery = () => board()?.delivery;
  const interactions = () => board()?.interactions || [];
  const overview = () => board()?.overview;
  const goalsCards = createMemo(() => {
    const lanes = board()?.lanes || [];
    const goalsLane = lanes.find((l) => l.id === "goals");
    return goalsLane?.cards || [];
  });
  const runningGoalIDs = createMemo(() => {
    const goalRuns = board()?.goalRuns || [];
    return new Set(goalRuns.filter((gr) => gr.status === "running" || gr.status === "accepted").map((gr) => gr.goalID).filter(Boolean));
  });
  const goalsBadgeText = createMemo(() => {
    const cards = goalsCards();
    if (cards.length === 0) return "";
    const passed = cards.filter((c) => c.status === "passed").length;
    return `${passed}/${cards.length}`;
  });
  const goalsBadgeTone = createMemo(() => {
    const cards = goalsCards();
    if (cards.length === 0) return "";
    const passed = cards.filter((c) => c.status === "passed").length;
    return passed === cards.length ? "good" : passed > 0 ? "warn" : "";
  });
  return [(() => {
    var _el$90 = _tmpl$37();
    insert(_el$90, createComponent(TaskActionsPanel, {
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
    return _el$90;
  })(), createComponent(SectionFrame, {
    id: "specSection",
    get title() {
      return t("section.spec");
    },
    get icon() {
      return SECTION_ICONS.spec;
    },
    bodyId: "specBody",
    badgeId: "specBadge",
    get badgeText() {
      return memo(() => !!spec())() ? t("common.active") : "";
    },
    get badgeTone() {
      return spec() ? "accent" : "";
    },
    get children() {
      return createComponent(SpecPanel, {
        get spec() {
          return spec();
        },
        get preview() {
          return boardStore.specPreview;
        }
      });
    }
  }), createComponent(SectionFrame, {
    id: "goalsSection",
    get title() {
      return t("section.goals");
    },
    get icon() {
      return SECTION_ICONS.goals;
    },
    bodyId: "goalsBody",
    badgeId: "goalsBadge",
    get badgeText() {
      return goalsBadgeText();
    },
    get badgeTone() {
      return goalsBadgeTone();
    },
    get children() {
      return [createComponent(GoalsPanel, {
        get cards() {
          return goalsCards();
        },
        get runningGoalIDs() {
          return runningGoalIDs();
        },
        get onEditGoal() {
          return props.onEditGoal;
        },
        get onDeleteGoal() {
          return props.onDeleteGoal;
        },
        get onOpenSession() {
          return props.onOpenSession;
        }
      }), createComponent(InteractionsList, {
        get interactions() {
          return interactions();
        },
        get onResolve() {
          return props.onResolveInteraction;
        },
        get onReject() {
          return props.onRejectInteraction;
        }
      })];
    }
  }), createComponent(SectionFrame, {
    id: "planSection",
    get title() {
      return t("section.plan");
    },
    get icon() {
      return SECTION_ICONS.plan;
    },
    bodyId: "planBody",
    badgeId: "planBadge",
    get badgeText() {
      return memo(() => runningGoalIDs().size > 0)() ? String(runningGoalIDs().size) : "";
    },
    get badgeTone() {
      return runningGoalIDs().size > 0 ? "accent" : "";
    },
    get children() {
      return createComponent(PlanPanel, {
        get plan() {
          return plan();
        },
        get preview() {
          return boardStore.planPreview;
        },
        get goalCards() {
          return goalsCards();
        },
        get runningGoalIDs() {
          return runningGoalIDs();
        }
      });
    }
  }), createComponent(SectionFrame, {
    id: "criteriaSection",
    get title() {
      return t("section.evaluation");
    },
    get icon() {
      return SECTION_ICONS.criteria;
    },
    bodyId: "criteriaBody",
    badgeId: "criteriaBadge",
    get badgeText() {
      const specs = criteriaSpecs(task(), evaluation());
      if (specs.length === 0) return "";
      const enabled = specs.filter((item) => item.enabled).length;
      if (enabled === 0) return t("checks.zero_enabled");
      const passed = specs.filter((item) => item.enabled && aggregateCheckStatus(evaluation()?.checks, item.name) === "passed").length;
      return `${passed}/${enabled}`;
    },
    get children() {
      return [createComponent(CriteriaPanel, {
        get task() {
          return task();
        },
        get evaluation() {
          return evaluation();
        },
        get onToggle() {
          return props.onToggleCriteria;
        }
      }), createComponent(EvaluationPanel, {
        get evaluation() {
          return evaluation();
        }
      })];
    }
  }), createComponent(SectionFrame, {
    id: "deliverySection",
    get title() {
      return t("section.delivery");
    },
    get icon() {
      return SECTION_ICONS.delivery;
    },
    bodyId: "evalBody",
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
  })];
}
delegateEvents(["click"]);

var _tmpl$$c = /* @__PURE__ */ template(`<div class=chat-attachments id=chatAttachments>`), _tmpl$2$a = /* @__PURE__ */ template(`<svg width=16 height=16 viewBox="0 0 16 16"fill=none><rect x=4.25 y=4.25 width=7.5 height=7.5 rx=1.2 fill=currentColor>`), _tmpl$3$a = /* @__PURE__ */ template(`<form id=chatForm class=chat-input><input id=chatFileInput type=file multiple hidden><div class=chat-compose-row><textarea id=chatTextarea class=chat-textarea rows=2></textarea><div class=chat-compose-actions><button type=button id=btnChatAttach class=chat-attach-btn><svg width=16 height=16 viewBox="0 0 16 16"fill=none aria-hidden=true><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5L9 3a2 2 0 012.8 2.8L6 11.6a.8.8 0 01-1.1-1.1L10.5 5"stroke=currentColor stroke-width=1.2 stroke-linecap=round stroke-linejoin=round></path></svg></button><button><span class=chat-send-icon aria-hidden=true></span><span class=chat-send-label></span></button></div></div><div class=chat-compose-meta><div class=chat-compose-meta-left><span class=chat-version id=chatVersion></span><span class=chat-author>代码生成组@同花顺</span></div><div class=chat-compose-tip>`), _tmpl$4$a = /* @__PURE__ */ template(`<img class=chat-attachment-thumb>`), _tmpl$5$a = /* @__PURE__ */ template(`<div class=chat-attachment-item><span class=chat-attachment-name></span><button type=button class=chat-attachment-remove aria-label=Remove>&times;`), _tmpl$6$9 = /* @__PURE__ */ template(`<span class=chat-attachment-icon>`), _tmpl$7$8 = /* @__PURE__ */ template(`<svg width=16 height=16 viewBox="0 0 16 16"fill=none><path d="M2 8l10-5-3 5 3 5z"fill=currentColor>`);
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
  const hasText = createMemo(() => text().trim().length > 0);
  const stopping = () => props.stopping === true;
  function sizeTextarea() {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    const style = getComputedStyle(document.documentElement);
    const min = Number.parseFloat(style.getPropertyValue("--ui-chat-min-height")) || 72;
    const max = Number.parseFloat(style.getPropertyValue("--ui-chat-max-height")) || 180;
    const h = Math.min(textareaRef.scrollHeight, max);
    textareaRef.style.height = `${Math.max(h, min)}px`;
  }
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
    if (textareaRef) {
      textareaRef.value = "";
      sizeTextarea();
    }
    props.onSubmit(trimmed, sentAttachments);
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
    var _el$ = _tmpl$3$a(), _el$3 = _el$.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$8.firstChild, _el$1 = _el$9.nextSibling, _el$10 = _el$4.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
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
        var _el$2 = _tmpl$$c();
        insert(_el$2, createComponent(For, {
          get each() {
            return attachments();
          },
          children: (att, index) => (() => {
            var _el$13 = _tmpl$5$a(), _el$15 = _el$13.firstChild, _el$16 = _el$15.nextSibling;
            insert(_el$13, createComponent(Show, {
              get when() {
                return att.mime.startsWith("image/");
              },
              get fallback() {
                return (() => {
                  var _el$17 = _tmpl$6$9();
                  insert(_el$17, () => att.filename?.split(".").pop()?.toUpperCase() || "FILE");
                  return _el$17;
                })();
              },
              get children() {
                var _el$14 = _tmpl$4$a();
                createRenderEffect((_p$) => {
                  var _v$11 = att.url, _v$12 = att.filename;
                  _v$11 !== _p$.e && setAttribute(_el$14, "src", _p$.e = _v$11);
                  _v$12 !== _p$.t && setAttribute(_el$14, "alt", _p$.t = _v$12);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0
                });
                return _el$14;
              }
            }), _el$15);
            insert(_el$15, () => att.filename || "file");
            _el$16.$$click = () => removeAttachment(index());
            createRenderEffect(() => setAttribute(_el$13, "title", att.filename));
            return _el$13;
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
      sizeTextarea();
    };
    var _ref$3 = textareaRef;
    typeof _ref$3 === "function" ? use(_ref$3, _el$5) : textareaRef = _el$5;
    _el$7.$$click = () => fileInputRef?.click();
    _el$8.$$click = (e) => {
      if (props.busy) {
        e.preventDefault();
        props.onStop?.();
      }
    };
    insert(_el$9, createComponent(Show, {
      get when() {
        return props.busy;
      },
      get fallback() {
        return _tmpl$7$8();
      },
      get children() {
        return _tmpl$2$a();
      }
    }));
    insert(_el$1, sendLabel);
    insert(_el$12, () => t("chat.tip"));
    createRenderEffect((_p$) => {
      var _v$ = dragover() ? "true" : void 0, _v$2 = !props.enabled, _v$3 = props.enabled ? t("chat.placeholder") : t("chat.placeholder_disabled"), _v$4 = t("chat.attach_title"), _v$5 = t("chat.attach_title"), _v$6 = props.busy ? "btnTaskInterrupt" : "chatSend", _v$7 = `chat-send${props.busy ? " chat-interrupt" : ""}`, _v$8 = props.busy ? "button" : "submit", _v$9 = props.busy ? "stop" : "send", _v$0 = sendDisabled(), _v$1 = sendTitle(), _v$10 = sendAriaLabel();
      _v$ !== _p$.e && setAttribute(_el$, "data-dragover", _p$.e = _v$);
      _v$2 !== _p$.t && (_el$5.disabled = _p$.t = _v$2);
      _v$3 !== _p$.a && setAttribute(_el$5, "placeholder", _p$.a = _v$3);
      _v$4 !== _p$.o && setAttribute(_el$7, "title", _p$.o = _v$4);
      _v$5 !== _p$.i && setAttribute(_el$7, "aria-label", _p$.i = _v$5);
      _v$6 !== _p$.n && setAttribute(_el$8, "id", _p$.n = _v$6);
      _v$7 !== _p$.s && className(_el$8, _p$.s = _v$7);
      _v$8 !== _p$.h && setAttribute(_el$8, "type", _p$.h = _v$8);
      _v$9 !== _p$.r && setAttribute(_el$8, "data-mode", _p$.r = _v$9);
      _v$0 !== _p$.d && (_el$8.disabled = _p$.d = _v$0);
      _v$1 !== _p$.l && setAttribute(_el$8, "title", _p$.l = _v$1);
      _v$10 !== _p$.u && setAttribute(_el$8, "aria-label", _p$.u = _v$10);
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
      u: void 0
    });
    createRenderEffect(() => _el$5.value = text());
    return _el$;
  })();
}
delegateEvents(["input", "keydown", "click"]);

function sanitizeTheme$1(value) {
  const text = String(value || "").trim();
  return text === "light" || text === "dark" || text === "vscode-dark" ? text : "dark";
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
  unattended: true,
  autoPermission: false,
  autoQuestion: false,
  showTranscriptDetails: false,
  sidebarCollapsed: false,
  sidebarWidth: null,
  sectionsWidth: null,
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
  directoryEpoch: 0
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
    unattended: input?.unattended !== false,
    autoPermission: input?.autoPermission === true,
    autoQuestion: input?.autoQuestion === true,
    showTranscriptDetails: input?.showTranscriptDetails === true,
    sidebarCollapsed: input?.sidebarCollapsed === true,
    sidebarWidth: sanitizePaneWidth(input?.sidebarWidth),
    sectionsWidth: sanitizePaneWidth(input?.sectionsWidth),
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
  localStorage.setItem("oc_unattended", String(s.unattended));
  localStorage.setItem("oc_auto_permission", String(s.autoPermission));
  localStorage.setItem("oc_auto_question", String(s.autoQuestion));
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
    unattended: localStorage.getItem("oc_unattended") !== "false",
    autoPermission: localStorage.getItem("oc_auto_permission") === "true",
    autoQuestion: localStorage.getItem("oc_auto_question") === "true",
    showTranscriptDetails: localStorage.getItem("oc_show_transcript_details") === "true",
    sidebarCollapsed: localStorage.getItem("oc_sidebar_collapsed") === "true",
    sidebarWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sidebar_width")
    ),
    sectionsWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sections_width")
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
    unattended: input.unattended ?? DEFAULT_SETTINGS.unattended,
    autoPermission: input.autoPermission ?? DEFAULT_SETTINGS.autoPermission,
    autoQuestion: input.autoQuestion ?? DEFAULT_SETTINGS.autoQuestion,
    showTranscriptDetails: input.showTranscriptDetails ?? DEFAULT_SETTINGS.showTranscriptDetails,
    sidebarCollapsed: input.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth || void 0,
    sectionsWidth: input.sectionsWidth || void 0,
    opacity: input.opacity ?? DEFAULT_SETTINGS.opacity,
    zoom: input.zoom ?? DEFAULT_SETTINGS.zoom,
    theme: input.theme ?? DEFAULT_SETTINGS.theme,
    locale: input.locale ?? DEFAULT_SETTINGS.locale,
    directoryMode: input.savedDirectory ? "custom" : "temp",
    directory: input.savedDirectory || void 0,
    workspaceTaskID: input.workspaceTaskID || void 0,
    workspaceDirectory: input.workspaceDirectory || void 0
  };
}

var _tmpl$$b = /* @__PURE__ */ template(`<button type=button id=btnPin class="btn btn-ghost icon-btn titlebar-btn"><svg width=12 height=12 viewBox="0 0 16 16"fill=none aria-hidden=true><path d="M9.5 2L14 6.5l-4 1.5-4 4-1.5-1.5 4-4L7 2.5 9.5 2z"stroke=currentColor stroke-width=1.3 stroke-linejoin=round></path><line x1=2 y1=14 x2=6 y2=10 stroke=currentColor stroke-width=1.3 stroke-linecap=round>`), _tmpl$2$9 = /* @__PURE__ */ template(`<button type=button id=btnMinimize class="btn btn-ghost icon-btn titlebar-btn"><svg width=11 height=11 viewBox="0 0 11 11"fill=none aria-hidden=true><line x1=1 y1=5.5 x2=10 y2=5.5 stroke=currentColor stroke-width=1.3 stroke-linecap=round>`), _tmpl$3$9 = /* @__PURE__ */ template(`<button type=button id=btnMaximize class="btn btn-ghost icon-btn titlebar-btn">`), _tmpl$4$9 = /* @__PURE__ */ template(`<button type=button id=btnClose class="btn btn-ghost icon-btn titlebar-btn titlebar-btn-close"><svg width=11 height=11 viewBox="0 0 11 11"fill=none aria-hidden=true><line x1=1 y1=1 x2=10 y2=10 stroke=currentColor stroke-width=1.3 stroke-linecap=round></line><line x1=10 y1=1 x2=1 y2=10 stroke=currentColor stroke-width=1.3 stroke-linecap=round>`), _tmpl$5$9 = /* @__PURE__ */ template(`<div class=window-controls data-no-drag=true>`);
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
    var _el$ = _tmpl$5$9();
    insert(_el$, createComponent(Show, {
      get when() {
        return tauriWin() !== null;
      },
      get children() {
        var _el$2 = _tmpl$$b();
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
        var _el$3 = _tmpl$2$9();
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
        var _el$4 = _tmpl$3$9();
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
        var _el$5 = _tmpl$4$9();
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
  if (value === "light" || value === "system" || value === "vscode-dark") return value;
  return "dark";
}
function sanitizeZoom(value) {
  const next = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) ? Math.min(Math.max(next, MIN_UI_ZOOM), MAX_UI_ZOOM) : 1;
}
function resolvedTheme() {
  const theme = sanitizeTheme(settingsStore.theme);
  if (theme === "system") {
    return systemThemeMedia?.matches ? "light" : "dark";
  }
  return theme;
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

var _tmpl$$a = /* @__PURE__ */ template(`<div class=titlebar-menu-wrap data-no-drag=true><button type=button id=btnTitlebarMenu class=titlebar-btn aria-controls=titlebarMenu aria-haspopup=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none aria-hidden=true><circle cx=3.5 cy=8 r=1.2 fill=currentColor></circle><circle cx=8 cy=8 r=1.2 fill=currentColor></circle><circle cx=12.5 cy=8 r=1.2 fill=currentColor></circle></svg></button><div id=titlebarMenu class=titlebar-menu-panel data-no-drag=true><button type=button id=btnLocale class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true>A</span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta id=btnLocaleLabel></span></span></button><button type=button id=btnTheme class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><circle cx=8 cy=8 r=3 stroke=currentColor stroke-width=1.2></circle><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta id=btnThemeValue></span></span></button><button type=button id=btnSettings class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><path d="M3 4h10M3 8h10M3 12h10"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path><circle cx=6 cy=4 r=1.6 fill=currentColor></circle><circle cx=10 cy=8 r=1.6 fill=currentColor></circle><circle cx=7.5 cy=12 r=1.6 fill=currentColor></circle></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span></button><button type=button id=btnLog class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><path d="M3 3h10M3 6.5h8M3 10h6M3 13.5h9"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span></button><button type=button id=btnPin class=titlebar-menu-item><span class=titlebar-menu-icon aria-hidden=true><svg width=14 height=14 viewBox="0 0 16 16"fill=none><path d="M8 1v6M5.5 7h5l-.5 4H6l-.5-4z"stroke=currentColor stroke-width=1.2 stroke-linecap=round stroke-linejoin=round></path><path d="M8 11v4"stroke=currentColor stroke-width=1.2 stroke-linecap=round></path></svg></span><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta id=btnPinValue></span></span></button><div class=titlebar-menu-divider aria-hidden=true></div><label class=titlebar-menu-toggle for=chkUnattended><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkUnattended type=checkbox></label><label class=titlebar-menu-toggle for=chkAutoPermission><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkAutoPermission type=checkbox></label><label class=titlebar-menu-toggle for=chkAutoQuestion><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkAutoQuestion type=checkbox></label><label class=titlebar-menu-toggle for=chkShowTranscriptDetails><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><input class=titlebar-menu-check id=chkShowTranscriptDetails type=checkbox></label><label class=titlebar-menu-range for=opacityRange><span class=titlebar-menu-copy><span class=titlebar-menu-title></span><span class=titlebar-menu-meta></span></span><span class=titlebar-menu-range-control><input class=titlebar-menu-slider id=opacityRange type=range min=50 max=100 step=5><span class=titlebar-menu-value id=opacityValue>%`);
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
  const themeLabel = createMemo(() => {
    const theme = sanitizeTheme(settingsStore.theme);
    if (theme === "light") return t("settings.theme.light");
    if (theme === "system") return t("settings.theme.system");
    if (theme === "vscode-dark") return t("settings.theme.vscode_dark");
    return t("settings.theme.dark");
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
  async function handleThemeToggle() {
    const next = resolvedTheme() === "light" ? "dark" : "light";
    setSettingsStore("theme", next);
    applyTheme(next);
    applySettings({
      ...settingsStore,
      theme: next
    });
    saveSettings();
    closeMenu();
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
    setSettingsStore("unattended", checked);
    applySettings({
      ...settingsStore,
      unattended: checked
    });
    saveSettings();
    closeMenu();
  }
  async function handleAutoPermissionChange(checked) {
    setSettingsStore("autoPermission", checked);
    applySettings({
      ...settingsStore,
      autoPermission: checked
    });
    saveSettings();
    closeMenu();
  }
  async function handleAutoQuestionChange(checked) {
    setSettingsStore("autoQuestion", checked);
    applySettings({
      ...settingsStore,
      autoQuestion: checked
    });
    saveSettings();
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
    var _el$ = _tmpl$$a(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$4.nextSibling, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$9.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$12.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$17.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling, _el$27 = _el$22.nextSibling, _el$28 = _el$27.nextSibling, _el$29 = _el$28.firstChild, _el$30 = _el$29.firstChild, _el$31 = _el$30.nextSibling, _el$32 = _el$29.nextSibling, _el$33 = _el$28.nextSibling, _el$34 = _el$33.firstChild, _el$35 = _el$34.firstChild, _el$36 = _el$35.nextSibling, _el$37 = _el$34.nextSibling, _el$38 = _el$33.nextSibling, _el$39 = _el$38.firstChild, _el$40 = _el$39.firstChild, _el$41 = _el$40.nextSibling, _el$42 = _el$39.nextSibling, _el$43 = _el$38.nextSibling, _el$44 = _el$43.firstChild, _el$45 = _el$44.firstChild, _el$46 = _el$45.nextSibling, _el$47 = _el$44.nextSibling, _el$48 = _el$43.nextSibling, _el$49 = _el$48.firstChild, _el$50 = _el$49.firstChild, _el$51 = _el$50.nextSibling, _el$52 = _el$49.nextSibling, _el$53 = _el$52.firstChild, _el$54 = _el$53.nextSibling, _el$55 = _el$54.firstChild;
    _el$2.$$click = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu();
    };
    _el$4.$$click = () => void handleLocaleToggle();
    insert(_el$7, () => t("settings.language"));
    insert(_el$8, localeLabel);
    _el$9.$$click = () => void handleThemeToggle();
    insert(_el$10, () => t("settings.theme"));
    insert(_el$11, themeLabel);
    _el$12.$$click = handleOpenSettings;
    insert(_el$15, () => t("titlebar.server_config"));
    insert(_el$16, () => t("common.open"));
    _el$17.$$click = handleOpenLog;
    insert(_el$20, () => t("titlebar.logs"));
    insert(_el$21, () => t("common.open"));
    _el$22.$$click = () => void handlePinToggle();
    insert(_el$25, () => t("titlebar.pin"));
    insert(_el$26, pinLabel);
    insert(_el$30, () => t("titlebar.unattended"));
    insert(_el$31, () => t("titlebar.unattended_hint"));
    _el$32.addEventListener("change", (e) => void handleUnattendedChange(e.target.checked));
    insert(_el$35, () => t("titlebar.auto_permission"));
    insert(_el$36, () => t("titlebar.auto_permission_hint"));
    _el$37.addEventListener("change", (e) => void handleAutoPermissionChange(e.target.checked));
    insert(_el$40, () => t("titlebar.auto_question"));
    insert(_el$41, () => t("titlebar.auto_question_hint"));
    _el$42.addEventListener("change", (e) => void handleAutoQuestionChange(e.target.checked));
    insert(_el$45, () => t("titlebar.full_transcript"));
    insert(_el$46, () => t("titlebar.full_transcript_hint"));
    _el$47.addEventListener("change", (e) => void handleShowTranscriptDetailsChange(e.target.checked));
    insert(_el$50, () => t("titlebar.opacity"));
    insert(_el$51, () => t("titlebar.opacity_hint"));
    _el$53.addEventListener("change", (e) => void handleOpacityChange(e.target.value));
    _el$53.$$input = (e) => handleOpacityInput(e.target.value);
    insert(_el$54, opacityPct, _el$55);
    createRenderEffect((_p$) => {
      var _v$ = t("titlebar.more"), _v$2 = t("titlebar.more"), _v$3 = menuOpen() ? "true" : "false", _v$4 = !menuOpen(), _v$5 = localeToggleTitle(), _v$6 = localeToggleTitle(), _v$7 = resolvedTheme() === "light" ? t("titlebar.theme.dark") : t("titlebar.theme.light"), _v$8 = resolvedTheme() === "light" ? t("titlebar.theme.dark") : t("titlebar.theme.light"), _v$9 = resolvedTheme(), _v$0 = sanitizeTheme(settingsStore.theme), _v$1 = t("titlebar.server_config"), _v$10 = t("titlebar.server_config"), _v$11 = t("titlebar.logs"), _v$12 = t("titlebar.logs"), _v$13 = t("titlebar.pin"), _v$14 = t("titlebar.pin"), _v$15 = settingsStore.alwaysOnTop ? "true" : "false";
      _v$ !== _p$.e && setAttribute(_el$2, "title", _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$2, "aria-label", _p$.t = _v$2);
      _v$3 !== _p$.a && setAttribute(_el$2, "aria-expanded", _p$.a = _v$3);
      _v$4 !== _p$.o && (_el$3.hidden = _p$.o = _v$4);
      _v$5 !== _p$.i && setAttribute(_el$4, "title", _p$.i = _v$5);
      _v$6 !== _p$.n && setAttribute(_el$4, "aria-label", _p$.n = _v$6);
      _v$7 !== _p$.s && setAttribute(_el$9, "title", _p$.s = _v$7);
      _v$8 !== _p$.h && setAttribute(_el$9, "aria-label", _p$.h = _v$8);
      _v$9 !== _p$.r && setAttribute(_el$9, "data-theme", _p$.r = _v$9);
      _v$0 !== _p$.d && setAttribute(_el$9, "data-mode", _p$.d = _v$0);
      _v$1 !== _p$.l && setAttribute(_el$12, "title", _p$.l = _v$1);
      _v$10 !== _p$.u && setAttribute(_el$12, "aria-label", _p$.u = _v$10);
      _v$11 !== _p$.c && setAttribute(_el$17, "title", _p$.c = _v$11);
      _v$12 !== _p$.w && setAttribute(_el$17, "aria-label", _p$.w = _v$12);
      _v$13 !== _p$.m && setAttribute(_el$22, "title", _p$.m = _v$13);
      _v$14 !== _p$.f && setAttribute(_el$22, "aria-label", _p$.f = _v$14);
      _v$15 !== _p$.y && setAttribute(_el$22, "data-pinned", _p$.y = _v$15);
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
      y: void 0
    });
    createRenderEffect(() => _el$32.checked = settingsStore.unattended);
    createRenderEffect(() => _el$37.checked = settingsStore.autoPermission);
    createRenderEffect(() => _el$42.checked = settingsStore.autoQuestion);
    createRenderEffect(() => _el$47.checked = settingsStore.showTranscriptDetails);
    createRenderEffect(() => _el$53.value = String(opacityPct()));
    return _el$;
  })();
}
delegateEvents(["click", "input"]);

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

var _tmpl$$9 = /* @__PURE__ */ template(`<span id=connBadge class=conn-badge aria-live=polite>`);
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
    var _el$ = _tmpl$$9();
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

function record$2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function parseToolInput(raw) {
  if (record$2(raw)) return raw;
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
  return properties.goalRunID || properties.goal_run_id || properties.executorSessionID || properties.executor_session_id || properties.runID || "";
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
  const properties = record$2(event?.properties) ? event.properties : record$2(event?.payload) ? event.payload : {};
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
const BOARD_EVENT_DEBOUNCE = 150;
let tasksKickTimer$1 = null;
function normalizedEventType(event) {
  const raw = String(event?.type || "").trim();
  return raw.startsWith("orchestrator.") ? raw.slice("orchestrator.".length) : raw;
}
function eventTaskID(event) {
  return String(event?.properties?.taskID || event?.payload?.taskID || "");
}
function eventSequence(event) {
  const value = Number(event?.sequence);
  return Number.isFinite(value) ? value : 0;
}
function boardInvalidatingEvent(type) {
  return type === "task.updated" || type === "task.completed" || type === "task.failed" || type === "task.cancelled" || type === "task.blocked" || type.startsWith("run.") || type.startsWith("plan.") || type.startsWith("goal.") || type.startsWith("delivery.") || type.startsWith("evaluation.") || type.startsWith("interaction.");
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
      startSSE(taskID);
      return;
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

let sseController = null;
let sseRetryTimer = null;
function startSSE(taskID) {
  stopSSE();
  const controller = new AbortController();
  sseController = controller;
  setSseConnected(false);
  (async () => {
    try {
      const after = Number(boardStore.taskSequence || 0);
      const path = after > 0 ? `task/${encodeURIComponent(taskID)}/events?after=${after}` : `task/${encodeURIComponent(taskID)}/events`;
      const res = await fetch(apiUrl(path), {
        headers: apiHeaders(),
        signal: controller.signal
      });
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      setSseConnected(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (event.type === "task.heartbeat" || event.type === "task.connected")
              continue;
            const handled = routeSSEEvent(event);
            if (!handled) {
              handleEventStreamEvent(event);
            }
          } catch {
          }
        }
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      console.warn("SSE disconnected", e.message);
    }
    setSseConnected(false);
    if (sseRetryTimer) clearTimeout(sseRetryTimer);
    sseRetryTimer = setTimeout(async () => {
      sseRetryTimer = null;
      if (boardStore.selectedTaskID !== taskID) return;
      await syncTask(taskID);
      await loadBoard();
      startSSE(taskID);
    }, 3e3);
  })();
}
function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  if (sseController) {
    sseController.abort();
  }
  sseController = null;
  setSseConnected(false);
  clearEventQueue();
}

function chatRequestTimeoutMs() {
  const overlayTiming = window.__ocOverlayTiming;
  const testTiming = window.__overlayTest;
  const override = typeof overlayTiming?.chatTimeoutMs === "number" ? overlayTiming.chatTimeoutMs : typeof testTiming?.chatTimeoutMs === "number" ? testTiming.chatTimeoutMs : void 0;
  const value = typeof override === "number" ? override : 10 * 60 * 1e3;
  return Math.max(value, 1e3);
}
function activeDirectory$1() {
  return boardStore.board?.task?.directory || settingsStore.directory || "";
}
function inactivityTimeoutError(timeoutMs) {
  return new DOMException(
    `Panel stream inactive for ${timeoutMs}ms`,
    "TimeoutError"
  );
}
function relayAbort(source, controller) {
  if (!source) return () => void 0;
  const abort = () => {
    controller.abort(
      source.reason instanceof Error ? source.reason : source.reason ?? void 0
    );
  };
  if (source.aborted) {
    abort();
    return () => void 0;
  }
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}
async function readWithAbort(reader, signal) {
  if (signal.aborted) {
    await reader.cancel(signal.reason).catch(() => void 0);
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      void reader.cancel(signal.reason).catch(() => void 0);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}
function panelRequestBody(text, metadata = {}, requestID = "", attachments = [], executor = "opencode") {
  const taskID = boardStore.selectedTaskID || void 0;
  const body = {
    surface: "panel",
    text,
    time_created: Date.now(),
    taskID,
    executor,
    request_id: requestID || void 0,
    allow_create: true,
    allow_session_mutation: false,
    directory: activeDirectory$1() || void 0,
    metadata: {
      selectedTaskID: taskID,
      ...metadata
    }
  };
  if (attachments.length > 0) {
    body.attachments = attachments.map((att) => ({
      mime: att.mime,
      url: att.url,
      ...att.filename ? { filename: att.filename } : {}
    }));
  }
  return body;
}
async function selectTask(taskID, options = {}) {
  const nextTaskID = taskID || "";
  if (nextTaskID === boardStore.selectedTaskID && boardStore.board) {
    return;
  }
  stopSSE();
  setBoardStore("board", null);
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
async function submitMessage(text, attachments = [], options = {}) {
  const requestID = options.requestID ?? crypto.randomUUID();
  const timeoutMs = chatRequestTimeoutMs();
  const controller = new AbortController();
  const cleanupRelay = relayAbort(options.signal, controller);
  const executor = settingsStore.executor ?? "opencode";
  let inactivityTimer = null;
  const markActivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      controller.abort(inactivityTimeoutError(timeoutMs));
    }, timeoutMs);
  };
  const body = JSON.stringify(
    panelRequestBody(
      text,
      options.metadata ?? {},
      requestID,
      attachments,
      executor
    )
  );
  markActivity();
  try {
    const res = await fetch(apiUrl("panel/message/stream"), {
      method: "POST",
      headers: { ...apiHeaders(), "Content-Type": "application/json" },
      body,
      signal: controller.signal
    });
    markActivity();
    if (!res.ok || !res.body) {
      throw new Error(`Panel stream failed: ${res.status} ${res.statusText}`);
    }
    await options.onOpen?.();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let result = null;
    const consume = async (chunk, flush = false) => {
      buf += chunk;
      const blocks = buf.split(/\r?\n\r?\n/);
      if (!flush) {
        buf = blocks.pop() || "";
      } else {
        buf = "";
      }
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) continue;
        try {
          const ev = JSON.parse(data);
          markActivity();
          await options.onEvent?.(ev);
          if (ev.type === "done") {
            result = ev.result;
          }
        } catch {
        }
      }
    };
    while (true) {
      const { done, value } = await readWithAbort(reader, controller.signal);
      if (done) {
        await consume(decoder.decode(), true);
        break;
      }
      markActivity();
      await consume(decoder.decode(value, { stream: true }));
    }
    if (!result) {
      throw new Error("Panel stream ended without a final result");
    }
    return result;
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    cleanupRelay();
  }
}
async function createTask(options) {
  const { text, attachments = [], metadata = {}, signal } = options;
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
      ...attachments.length > 0 ? {
        attachments: attachments.map((att) => ({
          mime: att.mime,
          url: att.url,
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
  const browse = escapeHtml$1(t("cwd.browse"));
  const create = escapeHtml$1(t("cwd.new"));
  const reset = escapeHtml$1(t("cwd.reset"));
  const recent = escapeHtml$1(t("cwd.recent"));
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
        <span class="task-dir-empty">${escapeHtml$1(t("cwd.unavailable"))}</span>
        <span class="task-dir-actions">${actions}</span>
      </span>
    `;
  }
  const items = pathItems(value);
  const open = t("cwd.open");
  const choose = t("cwd.choose_level");
  const nodes = items.map((item, index) => {
    const current = index === items.length - 1 ? ' data-current="true"' : "";
    const step = index ? `<button type="button" class="task-dir-step" data-path-set=${jsonAttr(items[index - 1].path)} title="${escapeHtml$1(`${choose}: ${items[index - 1].path}`)}" aria-label="${escapeHtml$1(`${choose}: ${items[index - 1].path}`)}">/</button>` : "";
    return `${step}<button type="button" class="task-dir-node" data-path-open=${jsonAttr(item.path)} title="${escapeHtml$1(`${open}: ${item.path}`)}" aria-label="${escapeHtml$1(`${open}: ${item.path}`)}"${current}>${escapeHtml$1(item.label)}</button>`;
  }).join("");
  return `
    <span class="task-dir-shell">
      <span class="task-dir-path">${nodes}</span>
      <span class="task-dir-actions">${actions}</span>
    </span>
  `;
}

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
  if (!vcs.branch) return t("git.init");
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
  if (!vcs.branch) return t("git.init_title");
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
  return !!settingsStore.directory && !vcs.branch;
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
    gitNode.textContent = gitLabel(vcs, dir);
    gitNode.setAttribute("title", gitTitle(vcs, dir));
    gitNode.dataset.state = actionable ? "action" : vcs?.dirty ? "dirty" : vcs?.clean ? "clean" : "idle";
    gitNode.dataset.actionable = String(actionable);
    gitNode.toggleAttribute("disabled", !actionable && !vcs?.branch);
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

var _tmpl$$8 = /* @__PURE__ */ template(`<div class=diff-lines>`), _tmpl$2$8 = /* @__PURE__ */ template(`<div class=diff-empty><p class=empty-hint>`), _tmpl$3$8 = /* @__PURE__ */ template(`<div class=diff-row><div class=diff-gutter></div><div class=diff-num></div><div class=diff-num></div><div class=diff-code>`), _tmpl$4$8 = /* @__PURE__ */ template(`<div class=diff-row data-kind=skip><div class=diff-gutter>...</div><div class=diff-num></div><div class=diff-num></div><div class=diff-code>`), _tmpl$5$8 = /* @__PURE__ */ template(`<div class="dialog-form diff-dialog-form"><div class=dialog-head><div class=diff-dialog-head><span class=dialog-title></span><span class=diff-dialog-meta><span class=change-status></span><span class=diff-dialog-stat data-tone=add>+</span><span class=diff-dialog-stat data-tone=del>-</span></span></div><button type=button class="btn btn-ghost mini">×</button></div><div class=diff-dialog-body>`), _tmpl$6$8 = /* @__PURE__ */ template(`<dialog class=dialog>`), _tmpl$7$7 = /* @__PURE__ */ template(`<div class=changes-summary><span></span><span class=changes-total><span data-tone=add>+</span><span data-tone=del>-`), _tmpl$8$5 = /* @__PURE__ */ template(`<div class=changes-list>`), _tmpl$9$4 = /* @__PURE__ */ template(`<div class=changes-panel>`), _tmpl$0$2 = /* @__PURE__ */ template(`<p class=empty-hint>`), _tmpl$1$1 = /* @__PURE__ */ template(`<button type=button class=change-row><span class=change-main><span class=change-path></span><span class=change-subline></span></span><span class=change-meta><span class=change-status></span><span class=diff-dialog-stat data-tone=add>+</span><span class=diff-dialog-stat data-tone=del>-`);
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
function DiffPreview(props) {
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
        var _el$2 = _tmpl$2$8(), _el$3 = _el$2.firstChild;
        insert(_el$3, () => t("diff.no_preview"));
        return _el$2;
      })();
    },
    get children() {
      var _el$ = _tmpl$$8();
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
              var _el$9 = _tmpl$4$8(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling, _el$11 = _el$10.nextSibling;
              insert(_el$11, () => tc("diff.unchanged_hidden", line.count ?? 0));
              return _el$9;
            })();
          },
          get children() {
            var _el$4 = _tmpl$3$8(), _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling;
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
function DiffDialog(props) {
  let dialogRef;
  const item = () => props.item;
  createEffect(() => {
    if (item() && dialogRef && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!item() && dialogRef?.open) {
      dialogRef.close();
    }
  });
  function close() {
    dialogRef?.close();
    props.onClose();
  }
  return (() => {
    var _el$12 = _tmpl$6$8();
    _el$12.$$click = (e) => {
      if (e.target === dialogRef) close();
    };
    addEventListener(_el$12, "close", props.onClose);
    var _ref$ = dialogRef;
    typeof _ref$ === "function" ? use(_ref$, _el$12) : dialogRef = _el$12;
    insert(_el$12, createComponent(Show, {
      get when() {
        return !!item();
      },
      get children() {
        var _el$13 = _tmpl$5$8(), _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling; _el$19.firstChild; var _el$21 = _el$19.nextSibling; _el$21.firstChild; var _el$23 = _el$15.nextSibling, _el$24 = _el$14.nextSibling;
        insert(_el$16, () => item().file);
        insert(_el$18, () => changeStatusLabel(item().status));
        insert(_el$19, () => item().additions, null);
        insert(_el$21, () => item().deletions, null);
        _el$23.$$click = close;
        insert(_el$24, createComponent(DiffPreview, {
          get item() {
            return item();
          }
        }));
        createRenderEffect((_p$) => {
          var _v$ = item().status, _v$2 = t("common.close");
          _v$ !== _p$.e && setAttribute(_el$18, "data-status", _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$23, "aria-label", _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$13;
      }
    }));
    return _el$12;
  })();
}
function ChangesPanel(props) {
  const [selectedItem, setSelectedItem] = createSignal(null);
  let fullDiffCache = null;
  const files = createMemo(() => {
    if (props.changes !== void 0) return props.changes;
    const derived = deriveChanges();
    if (derived.length > 0) return derived;
    if (Array.isArray(boardStore.changes) && boardStore.changes.length > 0) {
      return boardStore.changes;
    }
    const raw = boardStore.board?.changes;
    return Array.isArray(raw) ? raw : [];
  });
  const totalAdditions = createMemo(() => files().reduce((sum, item) => sum + (item.additions ?? 0), 0));
  const totalDeletions = createMemo(() => files().reduce((sum, item) => sum + (item.deletions ?? 0), 0));
  function deliveryRunID() {
    const board = boardStore.board;
    const delivery = board?.acceptedDelivery || board?.delivery || board?.candidateDelivery;
    return typeof delivery?.runID === "string" ? delivery.runID : "";
  }
  async function fetchFullDiffs(runID) {
    if (fullDiffCache && fullDiffCache.runID === runID) return fullDiffCache.diffs;
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
    fullDiffCache = {
      runID,
      diffs
    };
    return diffs;
  }
  async function openDiff(index) {
    const item = files()[index];
    if (!item) return;
    if (item.before !== void 0 || item.after !== void 0) {
      setSelectedItem(item);
      return;
    }
    const runID = deliveryRunID();
    if (!runID) {
      setSelectedItem(item);
      return;
    }
    const fullDiffs = await fetchFullDiffs(runID);
    const full = fullDiffs.find((d) => d.file === item.file);
    setSelectedItem(full || item);
  }
  function closeDiff() {
    setSelectedItem(null);
  }
  return (() => {
    var _el$25 = _tmpl$9$4();
    insert(_el$25, createComponent(Show, {
      get when() {
        return files().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$34 = _tmpl$0$2();
          insert(_el$34, (() => {
            var _c$2 = memo(() => !!props.hasSelectedTask);
            return () => _c$2() ? t("files.unavailable") : t("files.select_target");
          })());
          return _el$34;
        })();
      },
      get children() {
        return [(() => {
          var _el$26 = _tmpl$7$7(), _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling, _el$29 = _el$28.firstChild; _el$29.firstChild; var _el$31 = _el$29.nextSibling; _el$31.firstChild;
          insert(_el$27, () => tc("files.changed", files().length));
          insert(_el$29, totalAdditions, null);
          insert(_el$31, totalDeletions, null);
          return _el$26;
        })(), (() => {
          var _el$33 = _tmpl$8$5();
          insert(_el$33, createComponent(For, {
            get each() {
              return files();
            },
            children: (item, index) => (() => {
              var _el$35 = _tmpl$1$1(), _el$36 = _el$35.firstChild, _el$37 = _el$36.firstChild, _el$38 = _el$37.nextSibling, _el$39 = _el$36.nextSibling, _el$40 = _el$39.firstChild, _el$41 = _el$40.nextSibling; _el$41.firstChild; var _el$43 = _el$41.nextSibling; _el$43.firstChild;
              _el$35.$$click = () => openDiff(index());
              insert(_el$37, () => item.file);
              insert(_el$38, () => changeStatusLabel(item.status));
              insert(_el$40, () => changeStatusLabel(item.status));
              insert(_el$41, () => item.additions, null);
              insert(_el$43, () => item.deletions, null);
              createRenderEffect((_p$) => {
                var _v$3 = index(), _v$4 = item.file, _v$5 = item.status;
                _v$3 !== _p$.e && setAttribute(_el$35, "data-change-index", _p$.e = _v$3);
                _v$4 !== _p$.t && setAttribute(_el$35, "title", _p$.t = _v$4);
                _v$5 !== _p$.a && setAttribute(_el$40, "data-status", _p$.a = _v$5);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$35;
            })()
          }));
          return _el$33;
        })()];
      }
    }), null);
    insert(_el$25, createComponent(DiffDialog, {
      get item() {
        return selectedItem();
      },
      onClose: closeDiff
    }), null);
    return _el$25;
  })();
}
delegateEvents(["click"]);

var _tmpl$$7 = /* @__PURE__ */ template(`<div class=log-fields>`), _tmpl$2$7 = /* @__PURE__ */ template(`<div class=log-detail-block><div class=log-detail-title></div><pre class=log-detail-pre>`), _tmpl$3$7 = /* @__PURE__ */ template(`<details class=log-detail><summary></summary><div class=log-detail-block><div class=log-detail-title></div><pre class=log-detail-pre>`), _tmpl$4$7 = /* @__PURE__ */ template(`<span class=log-chip>=`), _tmpl$5$7 = /* @__PURE__ */ template(`<span class=log-delta>`), _tmpl$6$7 = /* @__PURE__ */ template(`<span class=log-service>`), _tmpl$7$6 = /* @__PURE__ */ template(`<div class=log-line><div class=log-line-head><span class=log-source></span><span>[<!>]</span><span class=log-ts></span></div><div class=log-msg>`), _tmpl$8$4 = /* @__PURE__ */ template(`<dialog id=logDialog class="dialog dialog-wide"><div class=dialog-form><div class=dialog-header><span class=dialog-title></span><div class=dialog-header-actions><select id=logLevelFilter class="select select-sm"><option value=debug>DEBUG</option><option value=info>INFO</option><option value=warn>WARN</option><option value=error>ERROR</option></select><button type=button id=btnLogServerLogs class="btn btn-ghost mini"></button><button type=button id=btnLogRefresh class="btn btn-ghost mini"></button><button type=button id=btnLogCopy class="btn btn-ghost mini"></button><button type=button id=btnLogClear class="btn btn-ghost mini danger"></button><button type=button id=btnCloseLog class="btn btn-ghost mini"></button></div></div><div id=logViewerBody class=log-viewer>`), _tmpl$9$3 = /* @__PURE__ */ template(`<div class=empty-hint>`);
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
        var _el$ = _tmpl$$7();
        insert(_el$, createComponent(For, {
          get each() {
            return items().slice(0, 6);
          },
          children: ([key, value]) => (() => {
            var _el$13 = _tmpl$4$7(), _el$14 = _el$13.firstChild;
            insert(_el$13, key, _el$14);
            insert(_el$13, () => logPreviewValue(value), null);
            return _el$13;
          })()
        }));
        return _el$;
      })(), (() => {
        var _el$2 = _tmpl$3$7(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling;
        insert(_el$3, () => t("log.details"));
        insert(_el$5, () => t("log.fields"));
        insert(_el$6, () => stringifyLogValue(fields(), 2));
        insert(_el$2, createComponent(Show, {
          get when() {
            return !!props.entry.raw;
          },
          get children() {
            var _el$7 = _tmpl$2$7(), _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling;
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
      var _el$0 = _tmpl$3$7(), _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
      insert(_el$1, () => t("log.details"));
      insert(_el$11, () => t("log.raw"));
      insert(_el$12, () => props.entry.raw);
      return _el$0;
    }
  })];
}
function LogLine(props) {
  return (() => {
    var _el$15 = _tmpl$7$6(), _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$18.firstChild, _el$21 = _el$19.nextSibling; _el$21.nextSibling; var _el$24 = _el$18.nextSibling, _el$25 = _el$16.nextSibling;
    insert(_el$17, () => logSourceLabel(props.entry.source));
    insert(_el$18, () => props.entry.level.toUpperCase(), _el$21);
    insert(_el$16, createComponent(Show, {
      get when() {
        return !!props.entry.delta;
      },
      get children() {
        var _el$22 = _tmpl$5$7();
        insert(_el$22, () => props.entry.delta);
        return _el$22;
      }
    }), _el$24);
    insert(_el$16, createComponent(Show, {
      get when() {
        return !!props.entry.service;
      },
      get children() {
        var _el$23 = _tmpl$6$7();
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
  let bodyRef;
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
    scrollToBottom();
  };
  const scrollToBottom = () => {
    if (bodyRef) bodyRef.scrollTop = bodyRef.scrollHeight;
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
  const doScroll = () => {
    Promise.resolve().then(() => scrollToBottom());
  };
  return (() => {
    var _el$26 = _tmpl$8$4(), _el$27 = _el$26.firstChild, _el$28 = _el$27.firstChild, _el$29 = _el$28.firstChild, _el$30 = _el$29.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.nextSibling, _el$34 = _el$33.nextSibling, _el$35 = _el$34.nextSibling, _el$36 = _el$35.nextSibling, _el$37 = _el$28.nextSibling;
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
    use((el) => bodyRef = el, _el$37);
    insert(_el$37, createComponent(Show, {
      get when() {
        return entries().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$38 = _tmpl$9$3();
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
          children: (entry) => {
            doScroll();
            return createComponent(LogLine, {
              entry
            });
          }
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

var _tmpl$$6 = /* @__PURE__ */ template(`<details>`), _tmpl$2$6 = /* @__PURE__ */ template(`<div class="message message-user"><div class=message-body><p>`), _tmpl$3$6 = /* @__PURE__ */ template(`<div class="message message-assistant"><div class=message-body>`), _tmpl$4$6 = /* @__PURE__ */ template(`<div class=message-text><span class=typing>……`), _tmpl$5$6 = /* @__PURE__ */ template(`<div class=message-text>`), _tmpl$6$6 = /* @__PURE__ */ template(`<div class=coding-tab-root style=flex-direction:column;height:100%><div class="chat-scroll coding-scroll"style="flex:1 1 auto;overflow:auto">`), _tmpl$7$5 = /* @__PURE__ */ template(`<div class=chat-empty>Build agent — ask anything about the codebase`);
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderMarkdown(text) {
  return escapeHtml(text).replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>').replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}
function CodingTab(props) {
  const [sessionID, setSessionID] = createSignal(null);
  const [messages, setMessages] = createSignal([]);
  const [busy, setBusy] = createSignal(false);
  let textBuffer = /* @__PURE__ */ new Map();
  let abortController = null;
  let scrollRef;
  props.onReady?.({
    send: (text) => void sendCodingMessage(text),
    stop: () => abortController?.abort(),
    busy
  });
  function scrollToBottomIfNeeded() {
    if (!scrollRef) return;
    const atBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 80;
    if (atBottom) {
      requestAnimationFrame(() => {
        scrollRef.scrollTop = scrollRef.scrollHeight;
      });
    }
  }
  createEffect(() => {
    if (!props.active) return;
    messages();
    scrollToBottomIfNeeded();
  });
  function handleCodingEvent(msgIndex, event) {
    if (event.type === "session") {
      setSessionID(event.sessionID ?? null);
      return;
    }
    if (event.type === "delta") {
      const current = textBuffer.get(event.partID) ?? "";
      const next = current + (event.delta ?? "");
      textBuffer.set(event.partID, next);
      setMessages((prev) => {
        const updated = prev.map((m, i) => {
          if (i !== msgIndex || m.role !== "assistant") return m;
          const parts = m.parts.map((p) => {
            if (p.type === "text" && p._partID === event.partID) {
              return {
                ...p,
                text: next
              };
            }
            return p;
          });
          const hasPart = parts.some((p) => p.type === "text" && p._partID === event.partID);
          if (!hasPart) {
            parts.push({
              type: "text",
              text: next,
              _partID: event.partID
            });
          }
          return {
            ...m,
            parts
          };
        });
        return updated;
      });
      return;
    }
    if (event.type === "part") {
      const p = event.part;
      if (p?.type === "tool") {
        setMessages((prev) => prev.map((m, i) => {
          if (i !== msgIndex || m.role !== "assistant") return m;
          const existing = m.parts.find((x) => x.type === "tool" && x._partID === p.id);
          if (!existing) {
            return {
              ...m,
              parts: [...m.parts, {
                type: "tool",
                tool: p.tool,
                state: p.state,
                _partID: p.id
              }]
            };
          }
          return {
            ...m,
            parts: m.parts.map((x) => x.type === "tool" && x._partID === p.id ? {
              ...x,
              state: p.state,
              tool: p.tool
            } : x)
          };
        }));
      }
      return;
    }
    if (event.type === "error") {
      const errorText = event.error?.message ?? JSON.stringify(event.error);
      setMessages((prev) => prev.map((m, i) => {
        if (i !== msgIndex || m.role !== "assistant") return m;
        return {
          ...m,
          parts: [...m.parts, {
            type: "text",
            text: `Error: ${errorText}`
          }]
        };
      }));
      return;
    }
    if (event.type === "done") {
      textBuffer.clear();
    }
  }
  async function sendCodingMessage(text) {
    if (busy() || !text.trim()) return;
    setBusy(true);
    textBuffer.clear();
    setMessages((prev) => [...prev, {
      role: "user",
      text
    }, {
      role: "assistant",
      parts: [],
      streaming: true
    }]);
    const assistantIndex = messages().length - 1;
    const controller = new AbortController();
    abortController = controller;
    try {
      const body = JSON.stringify({
        text,
        sessionID: sessionID() ?? void 0
      });
      const res = await fetch(apiUrl("coding/message/stream"), {
        method: "POST",
        headers: {
          ...apiHeaders(),
          "Content-Type": "application/json"
        },
        body,
        signal: controller.signal
      });
      if (!res.ok || !res.body) {
        throw new Error(`Coding stream failed: ${res.status}`);
      }
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
            const event = JSON.parse(line.slice(5).trim());
            handleCodingEvent(assistantIndex, event);
          } catch {
          }
        }
      }
      if (buffer.startsWith("data:")) {
        try {
          const event = JSON.parse(buffer.slice(5).trim());
          handleCodingEvent(assistantIndex, event);
        } catch {
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        const errText = err?.message ?? String(err);
        setMessages((prev) => prev.map((m, i) => {
          if (i !== assistantIndex || m.role !== "assistant") return m;
          return {
            ...m,
            parts: [...m.parts, {
              type: "text",
              text: `Error: ${errText}`
            }]
          };
        }));
      }
    } finally {
      setMessages((prev) => prev.map((m, i) => {
        if (i !== assistantIndex || m.role !== "assistant") return m;
        return {
          ...m,
          streaming: false
        };
      }));
      setBusy(false);
      abortController = null;
    }
  }
  onCleanup(() => {
    abortController?.abort();
  });
  function ToolPartView(pProps) {
    const status = () => pProps.part.state?.status ?? "running";
    const icon = () => {
      const s = status();
      return s === "completed" ? "done" : s === "error" ? "err" : "run";
    };
    const title = () => escapeHtml(pProps.part.state?.title ?? pProps.part.tool ?? "tool");
    const output = () => {
      const raw = pProps.part.state?.output;
      if (!raw) return "";
      return escapeHtml(stripAnsi(String(raw)).slice(0, 2e3));
    };
    return (() => {
      var _el$ = _tmpl$$6();
      createRenderEffect((_p$) => {
        var _v$ = `tool-block tool-${status()}`, _v$2 = `<summary>[${icon()}] ${title()}</summary>${output() ? `<pre class="tool-output">${output()}</pre>` : ""}`;
        _v$ !== _p$.e && className(_el$, _p$.e = _v$);
        _v$2 !== _p$.t && (_el$.innerHTML = _p$.t = _v$2);
        return _p$;
      }, {
        e: void 0,
        t: void 0
      });
      return _el$;
    })();
  }
  function UserMessageView(mProps) {
    return (() => {
      var _el$2 = _tmpl$2$6(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild;
      insert(_el$4, () => mProps.msg.text);
      return _el$2;
    })();
  }
  function AssistantMessageView(mProps) {
    const hasParts = createMemo(() => mProps.msg.parts.length > 0);
    return (() => {
      var _el$5 = _tmpl$3$6(), _el$6 = _el$5.firstChild;
      insert(_el$6, createComponent(Show, {
        get when() {
          return hasParts();
        },
        get fallback() {
          return createComponent(Show, {
            get when() {
              return mProps.msg.streaming;
            },
            get children() {
              return _tmpl$4$6();
            }
          });
        },
        get children() {
          return createComponent(For, {
            get each() {
              return mProps.msg.parts;
            },
            children: (part) => createComponent(Show, {
              get when() {
                return part.type === "text";
              },
              get fallback() {
                return createComponent(ToolPartView, {
                  part
                });
              },
              get children() {
                var _el$8 = _tmpl$5$6();
                createRenderEffect(() => _el$8.innerHTML = renderMarkdown(part.text));
                return _el$8;
              }
            })
          });
        }
      }));
      return _el$5;
    })();
  }
  const isEmpty = createMemo(() => messages().length === 0);
  return (() => {
    var _el$9 = _tmpl$6$6(), _el$0 = _el$9.firstChild;
    var _ref$ = scrollRef;
    typeof _ref$ === "function" ? use(_ref$, _el$0) : scrollRef = _el$0;
    insert(_el$0, createComponent(Show, {
      get when() {
        return !isEmpty();
      },
      get fallback() {
        return _tmpl$7$5();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return messages();
          },
          children: (msg) => createComponent(Show, {
            get when() {
              return msg.role === "user";
            },
            get fallback() {
              return createComponent(AssistantMessageView, {
                msg
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
    createRenderEffect((_$p) => setStyleProperty(_el$9, "display", props.active ? "flex" : "none"));
    return _el$9;
  })();
}

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
    const remoteUnattended = config?.unattended;
    if (typeof remoteUnattended === "boolean") {
      setSettingsStore("unattended", remoteUnattended);
      saveSettings();
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
function appendPendingAssistantPart(requestID, type, delta) {
  const chunk = typeof delta === "string" ? delta : "";
  if (!requestID || !chunk) return;
  const messageID = `pending-assistant:${requestID}`;
  const partID = `${messageID}:${type}`;
  let found = false;
  const next = store.messages.map((message) => {
    if (message?.info?.id !== messageID) return message;
    found = true;
    const parts = Array.isArray(message?.parts) ? [...message.parts] : [];
    const index = parts.findIndex((part) => part?.id === partID);
    if (index >= 0) {
      const current = parts[index];
      parts[index] = {
        ...current,
        type,
        text: `${String(current?.text || "")}${chunk}`
      };
    } else {
      parts.push({
        id: partID,
        type,
        text: chunk,
        messageID,
        sessionID: ""
      });
    }
    return {
      ...message,
      parts
    };
  });
  if (!found) {
    next.push({
      _synthetic: true,
      info: {
        id: messageID,
        role: "assistant",
        time: { created: Date.now() }
      },
      parts: [
        {
          id: partID,
          type,
          text: chunk,
          messageID,
          sessionID: ""
        }
      ]
    });
  }
  setMessages(next);
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
function ensureTaskListEntry(taskID, requestID, requestText, resultMessage) {
  if (!taskID) return;
  const task = boardStore.board?.task && boardStore.board.task.id === taskID ? boardStore.board.task : null;
  const now = Date.now();
  const created = Number(task?.time?.created || now);
  const updated = Number(task?.time?.updated || created);
  const title = String(
    task?.title || boardStore.board?.overview?.headline || requestText || resultMessage || taskID
  ).trim();
  const entry = {
    task: {
      id: taskID,
      requestID: requestID || task?.requestID || "",
      title,
      status: task?.status || "planning",
      directory: task?.directory || "",
      time: {
        created,
        updated
      }
    },
    updated_at: updated,
    pending_interactions: 0
  };
  const rest = boardStore.tasks.filter((item) => item?.task?.id !== taskID);
  setTasksData([entry, ...rest]);
}
async function applyPanelResult(result) {
  const taskID = String(result?.task_id || result?.taskID || "");
  const requestText = typeof result?._request === "string" ? result._request : "";
  const requestID = String(result?._requestID || "");
  if (taskID) {
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""));
    await selectTask(taskID);
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""));
    if (result?.message) {
      const text = String(result.message);
      const alreadyVisible = store.messages.some(
        (item) => (Array.isArray(item?.parts) ? item.parts : []).some(
          (part) => part?.type === "text" && String(part?.text || "") === text
        )
      );
      if (alreadyVisible) return;
      setMessages(
        mergeMessages(store.messages, [
          syntheticTextMessage("assistant", Date.now(), text)
        ])
      );
    }
    return;
  }
  if (result?.message) {
    setMessages(
      mergeMessages(store.messages, [
        syntheticTextMessage("assistant", Date.now(), String(result.message))
      ])
    );
  }
}
async function panelMessage(text, attachments = [], metadata = {}) {
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
        metadata,
        signal: controller.signal
      });
      if (taskID) {
        await selectTask(taskID);
        return { task_id: taskID };
      }
      throw new Error("Task creation returned no task_id");
    }
    const result = await submitMessage(text, attachments, {
      requestID,
      metadata,
      signal: controller.signal,
      onEvent: async (event) => {
        const type = String(event?.type || "");
        if (type === "reasoning_delta") {
          appendPendingAssistantPart(requestID, "reasoning", String(event?.delta || ""));
          return;
        }
        if (type === "message_delta") {
          appendPendingAssistantPart(requestID, "text", String(event?.delta || ""));
        }
      }
    });
    await applyPanelResult({ ...result, _request: text, _requestID: requestID });
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
    if (interaction.type === "permission") {
      return stateFlag("autoPermission", settingsStore.autoPermission);
    }
    if (interaction.type === "question")
      return stateFlag("autoQuestion", settingsStore.autoQuestion) || stateFlag("unattended", settingsStore.unattended);
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

let codingActive$1 = false;
function switchTab(tab) {
  codingActive$1 = tab === "coding";
  const tabControl = document.getElementById("tabControl");
  const tabCoding = document.getElementById("tabCoding");
  const chatScroll = document.getElementById("chatScroll");
  const codingScroll = document.getElementById("codingScroll");
  const chatGoalsStrip = document.getElementById("chatGoalsStrip");
  const taskStatus = document.getElementById("taskStatus");
  const toggle = document.getElementById("modeToggle");
  if (tabControl) tabControl.classList.toggle("active", !codingActive$1);
  if (tabCoding) tabCoding.classList.toggle("active", codingActive$1);
  if (chatScroll) chatScroll.hidden = codingActive$1;
  if (codingScroll) codingScroll.hidden = !codingActive$1;
  if (chatGoalsStrip) chatGoalsStrip.hidden = codingActive$1;
  if (taskStatus) {
    taskStatus.hidden = codingActive$1 || !store.selectedTaskID;
  }
  if (toggle) {
    toggle.textContent = codingActive$1 ? "Build" : t("chat.title");
  }
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

function sameBudget(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
function budgetMinutes(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const next = Math.round(value / 6e4 * 10) / 10;
  return Number.isInteger(next) ? String(next) : next.toFixed(1);
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
    maxReplans: budgetNumber(
      document.getElementById("budgetMaxReplans"),
      { allowZero: true }
    ),
    maxEvaluations: budgetNumber(
      document.getElementById("budgetMaxEvaluations")
    ),
    maxWallTimeMs: budgetNumber(
      document.getElementById("budgetMaxWallTime"),
      { scale: 6e4 }
    )
  };
  if (Object.values(budget).every((v) => v === void 0)) return void 0;
  return budget;
}

function taskBudget(task = boardStore.board?.task) {
  const budget = task?.budget;
  if (!budget || typeof budget !== "object") return void 0;
  return {
    maxRuns: Number.isFinite(budget.maxRuns) ? budget.maxRuns : void 0,
    maxReplans: Number.isFinite(budget.maxReplans) ? budget.maxReplans : void 0,
    maxEvaluations: Number.isFinite(budget.maxEvaluations) ? budget.maxEvaluations : void 0,
    maxWallTimeMs: Number.isFinite(budget.maxWallTimeMs) ? budget.maxWallTimeMs : void 0
  };
}
function setBudgetInputs(budget) {
  const setValue = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = value;
  };
  setValue("budgetMaxRuns", budget?.maxRuns === void 0 ? "" : String(budget.maxRuns));
  setValue("budgetMaxReplans", budget?.maxReplans === void 0 ? "" : String(budget.maxReplans));
  setValue(
    "budgetMaxEvaluations",
    budget?.maxEvaluations === void 0 ? "" : String(budget.maxEvaluations)
  );
  setValue(
    "budgetMaxWallTime",
    budget?.maxWallTimeMs === void 0 ? "" : budgetMinutes(budget.maxWallTimeMs)
  );
}
function orchestratorDefaults() {
  const orch = appStore.config?.orchestrator;
  if (!orch || typeof orch !== "object") return {};
  return {
    maxRuns: Number.isFinite(orch.max_runs) ? orch.max_runs : void 0,
    maxReplans: Number.isFinite(orch.max_replans) ? orch.max_replans : void 0,
    maxEvaluations: Number.isFinite(orch.max_evaluations) ? orch.max_evaluations : void 0,
    maxWallTimeMs: Number.isFinite(orch.max_wall_time_ms) ? orch.max_wall_time_ms : void 0
  };
}
function setPlaceholders() {
  const defaults = orchestratorDefaults();
  const setPlaceholder = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.placeholder = value || t("budget.placeholder");
  };
  setPlaceholder("budgetMaxRuns", defaults.maxRuns != null ? String(defaults.maxRuns) : "");
  setPlaceholder("budgetMaxReplans", defaults.maxReplans != null ? String(defaults.maxReplans) : "");
  setPlaceholder("budgetMaxEvaluations", defaults.maxEvaluations != null ? String(defaults.maxEvaluations) : "");
  setPlaceholder("budgetMaxWallTime", defaults.maxWallTimeMs != null ? budgetMinutes(defaults.maxWallTimeMs) : "");
}
function renderBudgetState(task = boardStore.board?.task) {
  const budget = taskBudget(task);
  const changed = !sameBudget(draftBudget(), budget);
  const taskID = task?.id || boardStore.selectedTaskID;
  const enabled = !!taskID && !appStore.budgetSaving;
  const saveButton = document.getElementById("btnBudgetSave");
  const resetButton = document.getElementById("btnBudgetReset");
  const reloadButton = document.getElementById("btnBudgetReload");
  const hint = document.getElementById("budgetHint");
  if (saveButton) saveButton.disabled = !enabled || !changed;
  if (resetButton) resetButton.disabled = !enabled || !changed && !appStore.budgetDirty;
  if (reloadButton) reloadButton.disabled = !enabled || appStore.budgetSaving;
  if (hint) {
    hint.textContent = taskID ? t("budget.hint") : t("budget.empty");
  }
  setPlaceholders();
  for (const input of [
    document.getElementById("budgetMaxRuns"),
    document.getElementById("budgetMaxReplans"),
    document.getElementById("budgetMaxEvaluations"),
    document.getElementById("budgetMaxWallTime")
  ]) {
    if (input instanceof HTMLInputElement) input.disabled = !enabled;
  }
}
function renderBudget(task) {
  const budget = taskBudget(task);
  if (!appStore.budgetDirty) setBudgetInputs(budget);
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
    setBudgetInputs(taskBudget());
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
    if (!boardStore.selectedTaskID || appStore.budgetSaving) return;
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      await apiJson(`task/${encodeURIComponent(boardStore.selectedTaskID)}/budget`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget: draftBudget() || null })
      });
      setAppStore("budgetDirty", false);
      await loadBoard({ sync: true });
    } catch (error) {
      console.error("Failed to update task budget", error);
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
function configUnattended(config) {
  const value = config?.experimental?.unattended;
  return typeof value === "boolean" ? value : null;
}
async function syncUnattendedConfig(force = false) {
  if (!appStore.connected) return false;
  const unattended = settingsStore.unattended ?? true;
  const remote = configUnattended(appStore.config);
  if (!force && remote === unattended) return false;
  try {
    const saved = await updateConfig((current) => {
      current.experimental = current.experimental || {};
      current.experimental.unattended = unattended;
    });
    setAppStore("config", saved);
    return true;
  } catch (e) {
    console.error("[config] Failed to sync unattended mode", e);
    return false;
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
  const unattended = settingsStore.unattended !== false;
  const config = {
    $schema: "https://opencorvus.ai/config.json",
    experimental: {
      unattended
    },
    lsp: {
      biome: { disabled: true },
      eslint: { disabled: true }
    },
    orchestrator: {
      spec: { max_steps: 30, timeout_ms: 3e5, min_tool_calls: 3, quality_threshold: 0.6, max_attempts: 3 },
      planner: { max_steps: 30, timeout_ms: 3e5, min_tool_calls: 3, quality_threshold: 0.5, max_attempts: 3 },
      evaluator: { max_steps: 25, timeout_ms: 24e4, min_tool_calls: 3 },
      delivery: { max_steps: 40, timeout_ms: 6e5, max_retries: 2, min_tool_calls: 3 },
      max_runs: 10,
      max_replans: 3,
      same_plan_retry_limit: 2,
      stage_max_retries: 2
    },
    compaction: {
      auto: true,
      prune: true
    },
    agent: {},
    mode: {},
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
    await restoreWorkspaceDirectory().catch(
      (e) => console.error("[reloadProjectScope] restoreWorkspaceDirectory", e)
    );
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
  configUnattended,
  hasExplicitChecks,
  loadPromptCatalog,
  reloadProjectScope,
  resetPromptEntry,
  savePromptEntry,
  scaffoldProjectConfig,
  syncUnattendedConfig,
  updateConfig
}, Symbol.toStringTag, { value: 'Module' }));

var _tmpl$$5 = /* @__PURE__ */ template(`<div class=config-status-box>`), _tmpl$2$5 = /* @__PURE__ */ template(`<div class=prompt-grid>`), _tmpl$3$5 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$4$5 = /* @__PURE__ */ template(`<small>`), _tmpl$5$5 = /* @__PURE__ */ template(`<details class=prompt-diff-details><summary class=prompt-diff-summary></summary><div class=prompt-preview-card style=margin-top:0;border-top:none;opacity:0.7><div class=prompt-preview-head></div><div class="md-content prompt-preview-body">`), _tmpl$6$5 = /* @__PURE__ */ template(`<div class=prompt-card><div class=prompt-card-head><div class=prompt-card-copy><strong></strong><span></span></div><span class=extension-status></span></div><label class=field><span class=field-label></span><textarea class="field-input prompt-textarea"rows=8></textarea></label><div class=prompt-toolbar><span class=config-status-box></span><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-primary mini"></button></div></div><details class=prompt-diff-details><summary class=prompt-diff-summary></summary><div class=prompt-preview-card style="border-top:none;border-radius:0 0 var(--radius) var(--radius)"><div class="md-content prompt-preview-body">`);
function promptEntryID(entry) {
  return `${entry.scope}:${entry.key}`;
}
function promptGroupLabel(group) {
  if (group === "core") return t("prompt.group.core");
  if (group === "generator") return t("prompt.group.generator");
  if (group === "orchestrator") return t("prompt.group.orchestrator");
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
  return renderMarkdown$1(value);
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
      var _el$ = _tmpl$$5();
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
        var _el$3 = _tmpl$3$5();
        insert(_el$3, () => t("prompt.none"));
        return _el$3;
      })();
    },
    get children() {
      var _el$2 = _tmpl$2$5();
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
            var _el$4 = _tmpl$6$5(), _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$0 = _el$6.nextSibling, _el$1 = _el$5.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$1.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$22 = _el$12.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$24.firstChild;
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
                var _el$9 = _tmpl$4$5();
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
                var _el$17 = _tmpl$5$5(), _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling;
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

var _tmpl$$4 = /* @__PURE__ */ template(`<div class=config-status-box>`), _tmpl$2$4 = /* @__PURE__ */ template(`<div class=extension-head><label class=field><span class=field-label></span><input class=field-input type=url placeholder=https://opencorvus.example.com></label><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini">`), _tmpl$3$4 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$4$4 = /* @__PURE__ */ template(`<div class=extension-row><div class=extension-row-main><strong></strong><span></span><small class=channel-doc-credit></small></div><div class=channel-row-actions><span class=extension-status></span><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-primary mini">`), _tmpl$5$4 = /* @__PURE__ */ template(`<dialog class=dialog><div class=dialog-form><div class=dialog-head><h2 class=dialog-title></h2></div><div class=channel-doc-card><div class=channel-doc-copy><span class=channel-doc-title></span><small class=channel-doc-credit></small></div><button type=button class="btn btn-ghost"></button></div><div class=dialog-actions><button type=button class="btn btn-ghost"></button><button type=button class="btn btn-primary">`), _tmpl$6$4 = /* @__PURE__ */ template(`<label class="field field-inline"><span class=field-label></span><input type=checkbox>`), _tmpl$7$4 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input>`);
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
      var _el$ = _tmpl$$4();
      insert(_el$, notice);
      createRenderEffect(() => setAttribute(_el$, "data-status", noticeTone()));
      return _el$;
    }
  }), (() => {
    var _el$2 = _tmpl$2$4(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling, _el$7 = _el$6.firstChild;
    insert(_el$4, () => t("channel.public_url"));
    _el$5.$$input = (e) => setLocalPublicUrl(e.currentTarget.value);
    _el$7.$$click = handleSavePublicUrl;
    insert(_el$7, () => t("common.save"));
    createRenderEffect(() => _el$7.disabled = saving());
    createRenderEffect(() => _el$5.value = localPublicUrl());
    return _el$2;
  })(), (() => {
    var _el$8 = _tmpl$3$4();
    insert(_el$8, () => t("channel.public_url_hint"));
    return _el$8;
  })(), createComponent(Show, {
    get when() {
      return channels().length > 0;
    },
    get fallback() {
      return (() => {
        var _el$9 = _tmpl$3$4();
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
          var _el$0 = _tmpl$4$4(), _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$11.nextSibling, _el$13 = _el$1.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.nextSibling;
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
        var _el$17 = _tmpl$5$4(), _el$18 = _el$17.firstChild, _el$19 = _el$18.firstChild, _el$20 = _el$19.firstChild, _el$21 = _el$19.nextSibling, _el$22 = _el$21.firstChild, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$22.nextSibling, _el$26 = _el$21.nextSibling, _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling;
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
                var _el$29 = _tmpl$6$4(), _el$30 = _el$29.firstChild, _el$31 = _el$30.nextSibling;
                insert(_el$30, () => field.label);
                _el$31.addEventListener("change", (e) => handleFieldChange(field.key, e.currentTarget.checked));
                setAttribute(_el$31, "name", name);
                createRenderEffect(() => _el$31.checked = currentVal() !== false);
                return _el$29;
              })();
            }
            const inputType = field.type === "secret" ? "password" : "text";
            return (() => {
              var _el$32 = _tmpl$7$4(), _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling;
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

var _tmpl$$3 = /* @__PURE__ */ template(`<div class=loading-hint>`), _tmpl$2$3 = /* @__PURE__ */ template(`<div class=config-status-box data-status=error><button type=button class="btn btn-ghost mini">`), _tmpl$3$3 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini">`), _tmpl$4$3 = /* @__PURE__ */ template(`<div class=config-inline-form><label class=field><span class=field-label></span><select class=field-input><option value=path></option><option value=url></option><option value=git></option></select></label><label class=field><span class=field-label></span><div class=field-input-group><input class=field-input type=text></div></label><label class=field><span class=field-label></span><select class=field-input><option value=ask></option><option value=allow></option><option value=deny></option></select></label><div class="dialog-actions compact"><button type=button class="btn btn-ghost"></button><button type=button class="btn btn-primary">`), _tmpl$5$3 = /* @__PURE__ */ template(`<details class=config-subsection open><summary class=config-subsection-head></summary><div class=config-subsection-body><div class=extension-head><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini danger"></button></div></div><div class=extension-list id=skillList>`), _tmpl$6$3 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input type=url placeholder=https://example.com/mcp>`), _tmpl$7$3 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input type=text placeholder=npx>`), _tmpl$8$3 = /* @__PURE__ */ template(`<label class=field><span class=field-label></span><input class=field-input type=text placeholder="-y @modelcontextprotocol/server-filesystem C:\\repo">`), _tmpl$9$2 = /* @__PURE__ */ template(`<div class=config-inline-form><label class=field><span class=field-label></span><input class=field-input type=text placeholder=exa></label><label class=field><span class=field-label></span><select class=field-input><option value=remote></option><option value=local></option></select></label><div class="dialog-actions compact"><button type=button class="btn btn-ghost"></button><button type=button class="btn btn-primary">`), _tmpl$0$1 = /* @__PURE__ */ template(`<details class=config-subsection open><summary class=config-subsection-head></summary><div class=config-subsection-body><div class=extension-head><div class="dialog-actions compact"><button type=button class="btn btn-ghost mini"></button><button type=button class="btn btn-ghost mini danger"></button></div></div><div class=extension-list id=mcpList>`), _tmpl$1 = /* @__PURE__ */ template(`<details class=config-subsection><summary class=config-subsection-head></summary><div class=config-subsection-body><div class=extension-list id=skillMarketList>`), _tmpl$10 = /* @__PURE__ */ template(`<div class=empty-hint>`), _tmpl$11 = /* @__PURE__ */ template(`<button type=button class="btn btn-ghost mini danger">`), _tmpl$12 = /* @__PURE__ */ template(`<div class=extension-row><div class=extension-row-main><strong></strong><span></span><small></small></div><div class=extension-row-actions><span class=extension-status data-state=connected>`), _tmpl$13 = /* @__PURE__ */ template(`<div class=extension-row><div class=extension-row-main><strong></strong><span></span></div><span class=extension-status>`), _tmpl$14 = /* @__PURE__ */ template(`<small>`), _tmpl$15 = /* @__PURE__ */ template(`<button type=button class="btn btn-primary mini">`), _tmpl$16 = /* @__PURE__ */ template(`<div class=market-card><div class=market-card-main><strong></strong><span> · <!> · </span><small></small></div><div class=market-card-actions><span class=extension-status>`);
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
      var _el$ = _tmpl$$3();
      insert(_el$, () => t("common.loading"));
      return _el$;
    }
  }), createComponent(Show, {
    get when() {
      return notice();
    },
    get children() {
      var _el$2 = _tmpl$2$3(), _el$3 = _el$2.firstChild;
      insert(_el$2, notice, _el$3);
      _el$3.$$click = () => setNotice("");
      insert(_el$3, () => t("common.dismiss"));
      return _el$2;
    }
  }), (() => {
    var _el$4 = _tmpl$5$3(), _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling, _el$32 = _el$7.nextSibling;
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
        var _el$11 = _tmpl$4$3(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$16.nextSibling, _el$18 = _el$12.nextSibling, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling, _el$21 = _el$20.firstChild, _el$23 = _el$18.nextSibling, _el$24 = _el$23.firstChild, _el$25 = _el$24.nextSibling, _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$28 = _el$27.nextSibling, _el$29 = _el$23.nextSibling, _el$30 = _el$29.firstChild, _el$31 = _el$30.nextSibling;
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
            var _el$22 = _tmpl$3$3();
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
                var _el$74 = _tmpl$3$3();
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
            var _el$49 = _tmpl$6$3(), _el$50 = _el$49.firstChild, _el$51 = _el$50.nextSibling;
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
              var _el$52 = _tmpl$7$3(), _el$53 = _el$52.firstChild, _el$54 = _el$53.nextSibling;
              insert(_el$53, () => t("mcp.command"));
              _el$54.$$input = (e) => setMcpForm("command", e.currentTarget.value);
              createRenderEffect(() => _el$54.value = mcpForm.command);
              return _el$52;
            })(), (() => {
              var _el$55 = _tmpl$8$3(), _el$56 = _el$55.firstChild, _el$57 = _el$56.nextSibling;
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
                    var _el$95 = _tmpl$3$3();
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

var _tmpl$$2 = /* @__PURE__ */ template(`<div class=config-panel-card style=opacity:0.6;font-size:13px;padding:12px>No custom providers configured. Click "+ Add" to add an OpenAI-compatible provider.`), _tmpl$2$2 = /* @__PURE__ */ template(`<label class=field><span class=field-label>Provider ID</span><input class=field-input type=text placeholder="e.g. hexin, my-gateway">`), _tmpl$3$2 = /* @__PURE__ */ template(`<div class=config-panel-card style="margin-top:8px;border:1px solid var(--color-border, #444)"><h4 style="font-size:13px;margin:0 0 8px 0"></h4><label class=field><span class=field-label>Display Name</span><input class=field-input type=text placeholder="e.g. Hexin OpenAI Gateway"></label><label class=field><span class=field-label>API Base URL</span><input class=field-input type=url placeholder="e.g. https://my-gateway.com/v1"></label><label class=field><span class=field-label>API Key Env Variable</span><input class=field-input type=text placeholder="e.g. MY_API_KEY"></label><label class=field><span class=field-label>Models (one per line: id:display_name)</span><textarea class=field-input rows=4 placeholder="gpt-5.4-mini:GPT-5.4 Mini
gpt-5.4:GPT-5.4"style=font-family:monospace;font-size:12px;resize:vertical></textarea></label><div class="dialog-actions compact"style=margin-top:8px><button type=button class="btn mini">Cancel</button><button type=button class="btn btn-primary mini">`), _tmpl$4$2 = /* @__PURE__ */ template(`<div class=config-panel-group><h4 class=config-panel-group-title>Connected Providers</h4><div class=config-panel-card><div style=font-size:12px;opacity:0.6;margin-bottom:6px>Auto-detected providers from models.dev, env vars, and auth.`), _tmpl$5$2 = /* @__PURE__ */ template(`<div class=general-panel><div class=config-panel-group><h4 class=config-panel-group-title>Custom Providers<button type=button class="btn btn-primary mini"style=margin-left:auto;font-size:12px>+ Add`), _tmpl$6$2 = /* @__PURE__ */ template(`<div style=font-size:12px;opacity:0.7;margin-bottom:2px>Env: `), _tmpl$7$2 = /* @__PURE__ */ template(`<div class=config-panel-card style=margin-bottom:8px><div style=display:flex;align-items:center;justify-content:space-between;margin-bottom:4px><strong style=font-size:13px></strong><div style=display:flex;gap:6px><button type=button class="btn mini"style="font-size:11px;padding:2px 8px">Edit</button><button type=button class="btn mini"style="font-size:11px;padding:2px 8px;color:var(--color-danger, #e55)">Delete</button></div></div><div style=font-size:12px;opacity:0.7;margin-bottom:2px>API: </div><div style=font-size:12px;opacity:0.7>Models: `), _tmpl$8$2 = /* @__PURE__ */ template(`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--color-border, #333);font-size:12px"><span></span><span style=opacity:0.5> models`);
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
    var _el$ = _tmpl$5$2(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling;
    _el$5.$$click = startAdd;
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => providerEntries().length === 0)() && !showAdd();
      },
      get children() {
        return _tmpl$$2();
      }
    }), null);
    insert(_el$2, createComponent(For, {
      get each() {
        return providerEntries();
      },
      children: ([id, provider]) => (() => {
        var _el$29 = _tmpl$7$2(), _el$30 = _el$29.firstChild, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling, _el$35 = _el$30.nextSibling; _el$35.firstChild; var _el$39 = _el$35.nextSibling; _el$39.firstChild;
        insert(_el$31, () => provider.name || id);
        _el$33.$$click = () => startEdit(id);
        _el$34.$$click = () => handleDelete(id);
        insert(_el$35, () => provider.api, null);
        insert(_el$29, createComponent(Show, {
          get when() {
            return provider.env?.length;
          },
          get children() {
            var _el$37 = _tmpl$6$2(); _el$37.firstChild;
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
        var _el$7 = _tmpl$3$2(), _el$8 = _el$7.firstChild, _el$10 = _el$8.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$10.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$13.nextSibling, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$16.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$19.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling;
        insert(_el$8, (() => {
          var _c$ = memo(() => !!editing());
          return () => _c$() ? `Edit: ${editing()}` : "Add Custom Provider";
        })());
        insert(_el$7, createComponent(Show, {
          get when() {
            return !editing();
          },
          get children() {
            var _el$9 = _tmpl$2$2(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
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
        var _el$25 = _tmpl$4$2(), _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling; _el$27.firstChild;
        insert(_el$27, createComponent(For, {
          get each() {
            return catalogEntries();
          },
          children: (p) => (() => {
            var _el$41 = _tmpl$8$2(), _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling, _el$44 = _el$43.firstChild;
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
  if (interaction.type === "permission") return settingsStore.autoPermission;
  if (interaction.type === "question") return settingsStore.autoQuestion || settingsStore.unattended;
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
      const reply = settingsStore.autoPermission ? "always" : "once";
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
  return !!activeDirectory$2() && appStore.connected && !boardStore.vcs?.branch;
}
async function initGitCurrent(options = {}) {
  const dir = activeDirectory$2();
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
const [codingActive, setCodingActive] = createSignal(false);
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function setActiveTab(tab) {
  setCodingActive(tab === "coding");
  switchTab(tab);
}
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
  window.renderMarkdown = renderMarkdown$1;
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
    const description = document.getElementById("goalDescription")?.value.trim() || "";
    const criteria = document.getElementById("goalCriteria")?.value.trim() || "";
    if (!description) return;
    try {
      if (goalID) {
        await panelMessage(`Update goal ${goalID}.`, {
          goalID,
          description,
          criteria: criteria || "The requested change is implemented and acceptance checks pass.",
          taskID: boardStore.selectedTaskID || void 0
        });
      } else {
        const payload = criteria ? `/goal ${description}
Criteria: ${criteria}` : `/goal ${description}`;
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
const codingScrollEl = document.getElementById("codingScroll");
if (codingScrollEl) {
  codingScrollEl.innerHTML = "";
  render(() => createComponent(CodingTab, {
    get active() {
      return codingActive();
    },
    onReady: (api) => {
      codingAPI = api;
    }
  }), codingScrollEl);
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
          const textParts = parts.filter((p) => p.type === "text" && p.text && p.audience?.ui !== false).map((p) => `<p class="session-msg-text">${escapeHtml$1(p.text)}</p>`).join("");
          const toolParts = parts.filter((p) => p.type === "tool-invocation" || p.type === "tool-call").map((p) => {
            const name = p.toolName ?? p.tool ?? "tool";
            return `<p class="session-msg-tool">⚙ ${escapeHtml$1(name)}</p>`;
          }).join("");
          if (!textParts && !toolParts) return "";
          return `<div class="session-msg" data-role="${escapeHtml$1(role)}">
                <span class="session-msg-role">${escapeHtml$1(role)}</span>
                ${textParts}${toolParts}
              </div>`;
        }).filter(Boolean).join("");
        bodyEl.innerHTML = html || '<p class="empty-hint">No displayable messages.</p>';
      } catch (e) {
        bodyEl.innerHTML = `<p class="empty-hint">Failed to load session: ${escapeHtml$1(String(e))}</p>`;
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
  render(() => createComponent(ChatComposer, {
    get enabled() {
      return memo(() => !!codingActive())() ? true : canComposeChat();
    },
    get busy() {
      return memo(() => !!codingActive())() ? codingAPI?.busy() ?? false : !!store.chatRequest || isTaskInterruptable();
    },
    get stopping() {
      return memo(() => !!codingActive())() ? false : !!store.chatRequest?.stopping;
    },
    onSubmit: (text, attachments) => {
      if (codingActive() && codingAPI) {
        codingAPI.send(text);
      } else {
        void panelMessage(text, attachments);
      }
    },
    onStop: () => {
      if (codingActive() && codingAPI) {
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
    if (codingActive()) setActiveTab("control");
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
    const currentLabel = current ? `<div class="engine-model-current">${escapeHtml$1(t("executor.current_model") || "Current")}: <strong>${escapeHtml$1(current)}</strong></div>` : "";
    const items = models.map((mid) => `<button type="button" class="engine-model-item" data-executor-model="${escapeHtml$1(mid)}" data-active="${mid === current}">${escapeHtml$1(mid)}</button>`).join("");
    panel.innerHTML = currentLabel + (items || `<div class="engine-model-current">${escapeHtml$1(t("empty.overview") || "No models available")}</div>`);
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
document.getElementById("tabControl")?.addEventListener("click", () => {
  setActiveTab("control");
});
document.getElementById("tabCoding")?.addEventListener("click", () => {
  setActiveTab("coding");
});
document.getElementById("modeToggle")?.addEventListener("click", () => {
  setActiveTab(codingActive() ? "control" : "coding");
});
document.getElementById("btnChatCopyAll")?.addEventListener("click", () => {
  void copyChatConversation();
});
const interactionBridge = createOverlayInteractions({
  document,
  dom: {
    goalsBody: null
  },
  escapeHtml: escapeHtml$1,
  renderMarkdown: renderMarkdown$1,
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
    const task = boardStore.board?.task;
    const taskStatus = document.getElementById("taskStatus");
    const statusIconEl = document.getElementById("statusIcon");
    const statusLabelEl = document.getElementById("statusLabel");
    const status = task?.status || "idle";
    if (taskStatus) {
      taskStatus.hidden = !boardStore.selectedTaskID || codingActive();
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
    const isActive = ["running", "planning", "evaluating", "delivering", "queued"].includes(status);
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
setActiveTab("control");
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
    panel.innerHTML = `<div class="recent-dir-empty">${escapeHtml$1(t("cwd.recent_empty"))}</div>`;
    return;
  }
  panel.innerHTML = dirs.map((dir) => {
    const isActive = current && dir.toLowerCase() === current.toLowerCase();
    return `<div class="recent-dir-row" data-active="${isActive}"><button type="button" class="recent-dir-item" data-recent-dir="${escapeHtml$1(dir)}" title="${escapeHtml$1(dir)}">${escapeHtml$1(shortPath$2(dir))}</button><button type="button" class="recent-dir-remove" data-recent-remove="${escapeHtml$1(dir)}" title="${escapeHtml$1(t("common.delete"))}" aria-label="${escapeHtml$1(t("common.delete"))}">×</button></div>`;
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
