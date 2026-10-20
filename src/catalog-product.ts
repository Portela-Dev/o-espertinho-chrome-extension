// Serialized into the isolated page world: helpers stay inside this function.
export async function extractCatalogProduct(input: {
    profile: any;
    settings: any;
    originalUrl: string;
    allowedOrigins: string[];
}): Promise<any> {
    const reader = {
        text(value: string, max: number) {
            return value.replace(/\s+/gu, ' ').trim().slice(0, max);
        },
        money(value: string): number | null {
            let raw = value.replace(/R\$/gi, '').replace(/\s/gu, '');
            if (!/^\d+(?:[.,]\d+)*$/u.test(raw))
                return null;
            if (raw.includes(',')) {
                if (!/^\d{1,3}(?:\.\d{3})*,\d{1,2}$/u.test(raw) && !/^\d+,\d{1,2}$/u.test(raw))
                    return null;
                raw = raw.replaceAll('.', '').replace(',', '.');
            }
            else if (/^\d{1,3}(?:\.\d{3})+$/u.test(raw))
                raw = raw.replaceAll('.', '');
            else if (!/^\d+(?:\.\d{1,2})?$/u.test(raw))
                return null;
            const cents = Math.round(Number(raw) * 100);
            return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? cents : null;
        },
        matches(rule: any) {
            if (rule.match === 'url_contains')
                return location.href.includes(rule.value);
            if (rule.match === 'selector')
                return !!document.querySelector(rule.value);
            return (document.body?.innerText ?? '').slice(0, 500000).includes(rule.value);
        },
        state() {
            return input.settings.blockRules.find((r: any) => reader.matches(r))?.kind ?? null;
        },
        value(node: Element, rule: any) {
            let value = (node as HTMLElement).innerText || node.textContent || '';
            if (rule.mode === 'attribute')
                value = node.getAttribute(rule.attribute) ?? '';
            if (rule.wholeSelector) {
                const whole = node.querySelector(rule.wholeSelector)?.textContent?.replace(/\D/gu, '');
                const fraction = rule.fractionSelector ? node.querySelector(rule.fractionSelector)?.textContent?.replace(/\D/gu, '') : '';
                value = whole ? whole + ',' + (fraction || '00') : '';
            }
            return value.trim();
        },
        image(data: any, value: string) {
            try {
                const image = new URL(value, document.baseURI);
                if (image.protocol === 'https:' && !image.username && !image.password && data.images.length < 12 && !data.images.includes(image.href))
                    data.images.push(image.href);
            }
            catch { /* Ignore invalid images. */
            }
        },
        specification(data: any, node: Element, rule: any) {
            const name = node.querySelector(rule.nameSelector || 'th')?.textContent, val = node.querySelector(rule.valueSelector || 'td')?.textContent;
            if (!name || !val || data.specifications.length >= 80)
                return;
            const pair = {
                name: reader.text(name, 150), value: reader.text(val, 600)
            };
            if (!data.specifications.some((p: any) => p.name === pair.name && p.value === pair.value))
                data.specifications.push(pair);
        },
        category(data: any, categories: string[], value: string) {
            const parts = input.settings.categorySeparator ? value.split(input.settings.categorySeparator) : [value];
            for (const part of parts) {
                const clean = reader.text(part, 120);
                if (clean && categories.length < 30)
                    categories.push(clean);
            }
            data.category = categories.at(-1)?.slice(0, 80) ?? '';
        },
        url(data: any, value: string) {
            try {
                const url = new URL(value, document.baseURI);
                if (url.protocol === 'https:' && !url.username && !url.password && input.allowedOrigins.includes(url.origin))
                    data.productUrl = url.href;
            }
            catch { /* Retain the original URL. */
            }
        },
        fieldKey(field: string) {
            return ({
                price: 'priceCents', originalPrice: 'originalPriceCents'
            } as Record<string, string>)[field] ?? field;
        },
        apply(data: any, categories: string[], rule: any, node: Element, selector: string) {
            const value = reader.value(node, rule);
            if (!value && rule.mode !== 'pairs')
                return;
            switch (rule.field) {
                case 'images':
                    reader.image(data, value);
                    break;
                case 'specifications':
                    reader.specification(data, node, rule);
                    break;
                case 'category':
                    reader.category(data, categories, value);
                    break;
                case 'price':
                case 'originalPrice': {
                    const key = reader.fieldKey(rule.field);
                    if (data[key] === null)
                        data[key] = reader.money(value);
                    break;
                }
                case 'productUrl':
                    reader.url(data, value);
                    break;
                default: if (!data[rule.field])
                    data[rule.field] = reader.text(value, ({
                        title: 300, brand: 120, description: 4000, conditions: 1500, externalId: 100
                    } as Record<string, number>)[rule.field] ?? 300);
            }
            if (data.evidence.length < 600)
                data.evidence.push({
                    field: rule.field, selector
                });
        },
        nodes(selector: string, data: any, field: string): Element[] {
            try {
                return Array.from(document.querySelectorAll(selector)).slice(0, 80);
            }
            catch {
                data.warnings.push('Seletor inválido para ' + field);
                return [];
            }
        },
        completeRule(data: any, categories: string[], rule: any) {
            if (rule.field === 'category')
                return categories.length > 0;
            if (['images', 'specifications'].includes(rule.field))
                return false;
            return !!data[reader.fieldKey(rule.field)];
        },
        rule(data: any, categories: string[], rule: any) {
            for (const selector of rule.selectors) {
                for (const node of reader.nodes(selector, data, rule.field))
                    reader.apply(data, categories, rule, node, selector);
                if (reader.completeRule(data, categories, rule))
                    break;
            }
        },
        missing(data: any) {
            const fields = new Set(['title', 'price', ...input.profile.rules.filter((r: any) => r.required).map((r: any) => r.field)]);
            for (const field of fields) {
                const value = data[reader.fieldKey(String(field))];
                if (value === null || value === '' || Array.isArray(value) && !value.length)
                    data.missing.push(String(field));
            }
        },
        read() {
            const data: any = {
                title: '', brand: '', priceCents: null, originalPriceCents: null, description: '', category: '', conditions: '', externalId: '', productUrl: input.originalUrl, images: [], specifications: [], warnings: [], missing: [], evidence: [], collectedAt: new Date().toISOString()
            };
            const categories: string[] = [];
            for (const rule of input.profile.rules)
                reader.rule(data, categories, rule);
            reader.missing(data);
            if (data.originalPriceCents !== null && data.priceCents !== null && data.originalPriceCents <= data.priceCents)
                data.originalPriceCents = null;
            return {
                data, sourceCategoryPath: categories
            };
        }
    };
    const end = Date.now() + input.settings.timeoutMs;
    let result = reader.read();
    while (true) {
        const block = reader.state();
        if (block && block !== 'unavailable')
            return {
                blocked: block
            };
        if (block === 'unavailable') {
            result.data.priceCents = null;
            return {
                ...result, outcome: 'unavailable'
            };
        }
        if (!result.data.missing.length)
            return {
                ...result, outcome: 'success'
            };
        if (Date.now() >= end)
            return {
                outcome: 'technical_failure', reason: 'incomplete'
            };
        await new Promise(r => setTimeout(r, 250));
        result = reader.read();
    }
}
