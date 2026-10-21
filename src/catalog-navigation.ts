import type { BlockRule } from './catalog-types.js';
export function checkPageState(rules: BlockRule[]): string | null {
    for (const rule of rules) {
        let found = false;
        if (rule.match === 'url_contains')
            found = location.href.includes(rule.value);
        if (rule.match === 'selector')
            found = !!document.querySelector(rule.value);
        if (rule.match === 'text')
            found = (document.body?.innerText ?? '').slice(0, 500000).includes(rule.value);
        if (found)
            return rule.kind;
    }
    return null;
}
export class CatalogNavigation {
    constructor(private readonly browser: typeof chrome, private readonly state: () => {
        tabId?: number;
        windowId?: number;
        hostWindowId?: number;
    }, private readonly save: () => Promise<void>) {
    }
    async ensure(url: string, origins: string[], navigate = true) {
        const target = new URL(url);
        if (target.protocol !== 'https:' || target.username || target.password || !origins.includes(target.origin))
            throw new Error('permission');
        if (!await this.browser.permissions.contains({
            origins: origins.map(o => o + '/*')
        }))
            throw new Error('permission');
        const state = this.state();
        let tab: chrome.tabs.Tab | undefined;
        if (state.tabId && state.windowId) {
            try {
                const existing = await this.browser.tabs.get(state.tabId);
                tab = existing;
            }
            catch {
                delete state.tabId;
                delete state.windowId;
                await this.save();
            }
            if (tab && tab.windowId !== state.windowId)throw new Error('tab_closed');
        }
        if (!tab) {
            let win: chrome.windows.Window;
            try {
                win = state.hostWindowId!==undefined
                    ? await this.browser.windows.get(state.hostWindowId)
                    : await this.browser.windows.getLastFocused({windowTypes:['normal']});
            } catch {
                delete state.hostWindowId;
                win = await this.browser.windows.getLastFocused({windowTypes:['normal']});
            }
            if(win.id===undefined||win.type&&win.type!=='normal')throw new Error('tab_closed');
            tab = await this.browser.tabs.create({windowId:win.id,url:target.href,active:true});
            if (tab.id===undefined)
                throw new Error('tab_closed');
            state.tabId = tab.id;
            state.windowId = win.id;
            await this.save();
        }
        else {
            await this.moveToHost(tab);
            if(navigate)
            await this.browser.tabs.update(tab.id!, {
                url: target.href
            });
        }
        return tab.id!;
    }
    private async moveToHost(tab:chrome.tabs.Tab){
        const state=this.state();
        if(state.hostWindowId===undefined||state.hostWindowId===tab.windowId)return;
        const host=await this.browser.windows.get(state.hostWindowId);
        if(host.type&&host.type!=='normal')throw new Error('tab_closed');
        const moved=await this.browser.tabs.move(tab.id!,{windowId:state.hostWindowId,index:-1});
        if(Array.isArray(moved)||moved.windowId!==state.hostWindowId)throw new Error('tab_closed');
        state.windowId=state.hostWindowId;
        await this.save();
    }
    async wait(origins: string[], timeoutMs: number) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            const tab = await this.browser.tabs.get(this.state().tabId!);
            if (tab.windowId !== this.state().windowId)
                throw new Error('tab_closed');
            if (tab.url && !origins.includes(new URL(tab.url).origin))
                throw new Error('access_denied');
            if (tab.status === 'complete')
                return;
            await new Promise(r => setTimeout(r, 250));
        }
        throw new Error('incomplete');
    }
    async focus() {
        const state = this.state();
        if (!state.tabId || !state.windowId)
            throw new Error('tab_closed');
        try {
            const tab = await this.browser.tabs.get(state.tabId);
            if (tab.windowId !== state.windowId)
                throw new Error('tab_closed');
            await this.moveToHost(tab);
            await this.browser.tabs.update(state.tabId, {
                active: true
            });
            await this.browser.windows.update(state.windowId!, {
                focused: true
            });
        }
        catch {
            throw new Error('tab_closed');
        }
    }
    async inspect(rules: BlockRule[]) {
        const results = await this.browser.scripting.executeScript({
            target: {
                tabId: this.state().tabId!
            }, world: 'ISOLATED', func: checkPageState, args: [rules]
        });
        return results[0]?.result ?? null;
    }
}
