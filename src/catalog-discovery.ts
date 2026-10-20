// Serialized into the isolated world. No imports or credentials are used here.
export async function discoverPage(input: {
    config: any;
    rules: any[];
    action: 'read' | 'advance';
    page: number;
}): Promise<any> {
    const { config, rules } = input;
    const reader = {
        matches(rule: any) {
            if (rule.match === 'url_contains')
                return location.href.includes(rule.value);
            if (rule.match === 'selector')
                return !!document.querySelector(rule.value);
            return (document.body?.innerText ?? '').slice(0, 500000).includes(rule.value);
        },
        blocked() {
            return rules.find(r => r.kind !== 'unavailable' && reader.matches(r))?.kind ?? null;
        },
        safeUrl(raw: string) {
            const u = new URL(raw, document.baseURI);
            if (u.protocol !== 'https:' || u.username || u.password)
                throw new Error('permission');
            return u.href;
        },
        advance() {
            const p = config.pagination;
            if (p.mode === 'scroll') {
                const scroller = p.scrollContainerSelector ? document.querySelector(p.scrollContainerSelector) : window;
                if (!scroller)
                    throw new Error('configuration');
                scroller.scrollBy(0, p.scrollStepPx);
            }
            else {
                const next = document.querySelector<HTMLElement>(p.nextSelector);
                if (!next)
                    return {
                        end: true
                    };
                // Return before navigation destroys this script's document.
                setTimeout(() => next.click(), 0);
            }
            return {
                advanced: true
            };
        },
        async ready() {
            const end = Date.now() + config.rendering.timeoutMs;
            while (Date.now() < end) {
                const block = reader.blocked();
                if (block)
                    return block;
                if (document.querySelector(config.rendering.readySelector || config.extraction.itemSelector))
                    break;
                await new Promise(r => setTimeout(r, 200));
            }
            await new Promise(r => setTimeout(r, config.rendering.settleDelayMs));
            return reader.blocked();
        },
        links() {
            const cards = Array.from(document.querySelectorAll(config.extraction.itemSelector));
            if (!cards.length)
                throw new Error('emptyPage');
            if (cards.length > 500)
                throw new Error('limit');
            const links: string[] = [];
            let invalid = 0;
            for (const card of cards) {
                const el = config.extraction.linkSelector === ':scope' ? card : card.querySelector(config.extraction.linkSelector);
                const raw = el?.getAttribute(config.extraction.linkAttribute);
                try {
                    if (raw)
                        links.push(reader.safeUrl(raw));
                    else
                        invalid++;
                }
                catch {
                    invalid++;
                }
            }
            if (!links.length)
                throw new Error('invalidItem');
            return {
                links: [...new Set(links)], invalid
            };
        },
        next() {
            const p = config.pagination;
            let done = p.mode === 'single' || !!(p.endSelector && document.querySelector(p.endSelector));
            let nextUrl: string | undefined;
            if (!done && ['next', 'load_more'].includes(p.mode))
                ({
                    done, nextUrl
                } = reader.nextButton(p));
            if (p.mode === 'url')
                nextUrl = reader.safeUrl(p.urlTemplate.replaceAll('{page}', String(p.startPage + input.page * p.pageStep)));
            return {
                done, nextUrl
            };
        },
        nextButton(p: any) {
            const next = document.querySelector(p.nextSelector);
            const disabled = !!next && (next.hasAttribute('disabled') || next.getAttribute('aria-disabled') === 'true' || !!(p.disabledSelector && next.matches(p.disabledSelector)));
            if (!next || disabled) {
                if (!next && p.missingNextAction === 'failure')
                    throw new Error('pagination');
                return {
                    done: true, nextUrl: undefined
                };
            }
            const href = next.getAttribute('href');
            return {
                done: false, nextUrl: p.mode === 'next' && href ? reader.safeUrl(href) : undefined
            };
        }
    };
    const state = reader.blocked();
    if (state)
        return {
            blocked: state
        };
    if (config.rendering.frameSelector)
        throw new Error('configuration');
    if (input.action === 'advance')
        return reader.advance();
    const block = await reader.ready();
    if (block)
        return {
            blocked: block
        };
    return {
        ...reader.links(), ...reader.next(), url: location.href
    };
}
