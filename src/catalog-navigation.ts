import type { BlockRule } from './catalog-types.js';
export function checkPageState(rules: BlockRule[]): string | null {
  let unavailable=false;
  for (const rule of rules) {
    let found = false;
    if (rule.match === 'url_contains')
      found = location.href.includes(rule.value);
    if (rule.match === 'selector') found = !!document.querySelector(rule.value);
    if (rule.match === 'text')
      found = (document.body?.innerText ?? '')
        .slice(0, 500000)
        .includes(rule.value);
    if (found && rule.kind!=='unavailable') return rule.kind;
    if (found) unavailable=true;
  }
  return unavailable?'unavailable':null;
}
export class CatalogNavigation {
  private navigation?: {previous?: string; target: string; started: boolean};
  constructor(
    private readonly browser: typeof chrome,
    private readonly state: () => {
      tabId?: number;
      windowId?: number;
      hostWindowId?: number;
    },
    private readonly save: () => Promise<void>,
  ) {}
  async ensure(url: string, origins: string[], navigate = true) {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      !origins.includes(target.origin)
    )
      throw new Error('permission');
    if (
      !(await this.browser.permissions.contains({
        origins: origins.map((o) => o + '/*'),
      }))
    )
      throw new Error('permission');
    const state = this.state();
    let tab: chrome.tabs.Tab | undefined;
    tab = await this.existingTab();
    if (!tab) {
      let win: chrome.windows.Window;
      try {
        win =
          state.hostWindowId !== undefined
            ? await this.browser.windows.get(state.hostWindowId)
            : await this.browser.windows.getLastFocused({
                windowTypes: ['normal'],
              });
      } catch {
        delete state.hostWindowId;
        win = await this.browser.windows.getLastFocused({
          windowTypes: ['normal'],
        });
      }
      if (win.id === undefined || (win.type && win.type !== 'normal'))
        throw new Error('tab_closed');
      this.navigation = {target: target.href, started: false};
      tab = await this.browser.tabs.create({
        windowId: win.id,
        url: target.href,
        active: true,
      });
      if (tab.id === undefined) throw new Error('tab_closed');
      state.tabId = tab.id;
      state.windowId = win.id;
      await this.save();
    } else {
      await this.moveToHost(tab);
      if (navigate) {
        this.navigation = {previous: tab.url, target: target.href, started: false};
        const updated = await this.browser.tabs.update(tab.id!, {
          url: target.href,
        });
        this.navigation.started = updated?.status === 'loading';
      }
    }
    return tab.id!;
  }
  private async existingTab() {
    const state = this.state();
    let tab: chrome.tabs.Tab | undefined;
    if (state.tabId && state.windowId) {
      try {
        const existing = await this.browser.tabs.get(state.tabId);
        tab = existing;
      } catch {
        delete state.tabId;
        delete state.windowId;
        await this.save();
      }
      if (tab && tab.windowId !== state.windowId) throw new Error('tab_closed');
    }

    return tab;
  }
  private async moveToHost(tab: chrome.tabs.Tab) {
    const state = this.state();
    if (state.hostWindowId === undefined || state.hostWindowId === tab.windowId)
      return;
    const host = await this.browser.windows.get(state.hostWindowId);
    if (host.type && host.type !== 'normal') throw new Error('tab_closed');
    const moved = await this.browser.tabs.move(tab.id!, {
      windowId: state.hostWindowId,
      index: -1,
    });
    if (Array.isArray(moved) || moved.windowId !== state.hostWindowId)
      throw new Error('tab_closed');
    state.windowId = state.hostWindowId;
    await this.save();
  }
  async wait(origins: string[], timeoutMs: number) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const tab = await this.browser.tabs.get(this.state().tabId!);
      if (tab.windowId !== this.state().windowId) throw new Error('tab_closed');
      if (!(await this.browser.permissions.contains({origins: origins.map(o=>o+'/*')}))) throw new Error('permission');
      if (this.ready(tab,origins)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('incomplete');
  }
  private ready(tab: chrome.tabs.Tab, origins: string[]) {
    if (tab.pendingUrl) {
      this.allowed(tab.pendingUrl,origins);
      if (this.navigation) this.navigation.started=true;
      return false;
    }
    if (tab.status !== 'complete') {
      if (this.navigation) this.navigation.started=true;
      return false;
    }
    if (!tab.url || tab.url.startsWith('chrome-error:')) throw new Error('page_unreadable');
    this.allowed(tab.url,origins);
    const nav=this.navigation;
    if (nav && !nav.started && tab.url===nav.previous && tab.url!==nav.target) return false;
    this.navigation=undefined;
    return true;
  }
  private allowed(value: string, origins: string[]) {
    const url=new URL(value);
    if (url.protocol!=='https:' || url.username || url.password || !origins.includes(url.origin)) throw new Error('access_denied');
  }
  async inject(func: any, args: any[], origins: string[], timeoutMs: number, world: 'ISOLATED'|'MAIN'='ISOLATED', active: ()=>void=()=>{}) {
    const deadline=Date.now()+timeoutMs;
    for (let attempt=0;attempt<3;attempt++) {
      active();
      await this.wait(origins,Math.max(1,deadline-Date.now()));
      active();
      try {
        const results=await this.browser.scripting.executeScript({target:{tabId:this.state().tabId!},world,func,args});
        active();
        return results[0]?.result;
      } catch (error) {
        active();
        await this.retryAccess(error,attempt,deadline,origins);
      }
    }
    throw new Error('page_unreadable');
  }
  private async retryAccess(error: unknown, attempt: number, deadline: number, origins: string[]) {
    const message=error instanceof Error?error.message:'';
    if (!/Cannot access contents of (?:the page|url)|Missing host permission for the tab/i.test(message)) throw error;
    if (!(await this.browser.permissions.contains({origins:origins.map(o=>o+'/*')}))) throw new Error('permission');
    if (attempt===2 || Date.now()>=deadline) throw new Error('page_unreadable');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  async focus() {
    const state = this.state();
    if (!state.tabId || !state.windowId) throw new Error('tab_closed');
    try {
      const tab = await this.browser.tabs.get(state.tabId);
      if (tab.windowId !== state.windowId) throw new Error('tab_closed');
      await this.moveToHost(tab);
      await this.browser.tabs.update(state.tabId, {
        active: true,
      });
      await this.browser.windows.update(state.windowId!, {
        focused: true,
      });
    } catch {
      throw new Error('tab_closed');
    }
  }
  async inspect(rules: BlockRule[], origins: string[], timeoutMs: number, active: ()=>void=()=>{}) {
    return await this.inject(checkPageState,[rules],origins,timeoutMs,'ISOLATED',active) ?? null;
  }
}
