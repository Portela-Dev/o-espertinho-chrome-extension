// Serialized into the isolated page world: helpers stay inside this function.
export async function extractCatalogProduct(input: {
  profile: any;
  settings: any;
  originalUrl: string;
  allowedOrigins: string[];
  revealPrice?: boolean;
}): Promise<any> {
  const reader = {
    text(value: string, max: number) {
      return value.replace(/\s+/gu, ' ').trim().slice(0, max);
    },
    money(value: string): number | null {
      let raw = value.replace(/R\$/gi, '').replace(/\s/gu, '');
      if (!/^\d+(?:[.,]\d+)*$/u.test(raw)) return null;
      if (raw.includes(',')) {
        if (
          !/^\d{1,3}(?:\.\d{3})*,\d{1,2}$/u.test(raw) &&
          !/^\d+,\d{1,2}$/u.test(raw)
        )
          return null;
        raw = raw.replaceAll('.', '').replace(',', '.');
      } else if (/^\d{1,3}(?:\.\d{3})+$/u.test(raw))
        raw = raw.replaceAll('.', '');
      else if (!/^\d+(?:\.\d{1,2})?$/u.test(raw)) return null;
      const cents = Math.round(Number(raw) * 100);
      return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000
        ? cents
        : null;
    },
    selectedMoney(value: string, selection?: string): number | null {
      if (selection !== 'first_in_range') return reader.money(value);
      const range = /^\s*((?:R\$\s*)?\d[\d.,]*)\s*[-–—]\s*((?:R\$\s*)?\d[\d.,]*)\s*$/iu.exec(value);
      if (!range) return reader.money(value);
      if (reader.money(range[2]) === null) return null;
      return reader.money(range[1]);
    },
    reviewNumber(value: string, count: boolean): number | null {
      const clean = value.trim();
      if (/^[-−]/u.test(clean)) return null;
      const match = /\d+(?:[.,]\d+)*/u.exec(clean);
      if (!match) return null;
      let raw = match[0];
      const abbreviated = count && /(?:^|[\s\d])(?:mil|k)\b/iu.test(clean);
      if (count && !abbreviated) {
        if (!/^\d+$|^\d{1,3}(?:[.,]\d{3})+$/u.test(raw)) return null;
        raw = raw.replace(/[.,]/gu, '');
      } else raw = raw.replace(',', '.');
      const number = Number(raw) * (abbreviated ? 1000 : 1);
      if (
        !Number.isFinite(number) ||
        number < 0 ||
        number > (count ? 1000000000 : 5) ||
        (count && !Number.isInteger(number))
      )
        return null;
      return number;
    },
    matches(rule: any) {
      if (rule.match === 'url_contains')
        return location.href.includes(rule.value);
      if (rule.match === 'selector')
        return !!document.querySelector(rule.value);
      return (document.body?.innerText ?? '')
        .slice(0, 500000)
        .includes(rule.value);
    },
    state() {
      let unavailable = false;
      for (const rule of input.settings.blockRules) {
        if (!reader.matches(rule)) continue;
        if (rule.kind !== 'unavailable') return rule.kind;
        unavailable = true;
      }
      return unavailable ? 'unavailable' : null;
    },
    revealLinkAllowed(node: Element) {
      const anchor = node.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return true;
      const url = new URL(anchor.href, document.baseURI);
      return url.protocol === 'https:' && !url.username && !url.password && input.allowedOrigins.includes(url.origin);
    },
    revealTarget(rule: any): HTMLElement | null {
      try {
        if (!rule?.priceReveal || !input.allowedOrigins.includes(location.origin)) return null;
        const node = document.querySelector<HTMLElement>(rule.priceReveal.clickSelector);
        if (!node || typeof node.click !== 'function' || node.closest('[hidden],[inert],:disabled,[aria-disabled="true"]')) return null;
        if (!node.checkVisibility()) return null;
        const control = node.closest<HTMLButtonElement | HTMLInputElement>('button,input');
        if (control?.form && control.type === 'submit') return null;
        if (!reader.revealLinkAllowed(node)) return null;
        return node;
      } catch { return null; }
    },
    revealPrice(rule: any) {
      try {
        const node = reader.revealTarget(rule);
        if (!node) return false;
        node.click();
        return true;
      } catch { return false; }
    },
    canRequestReveal(result: any, rule: any) {
      return !input.revealPrice && result.data.priceCents === null && !!reader.revealTarget(rule);
    },
    stateResult(result: any) {
      const block = reader.state();
      if (block && block !== 'unavailable') return {blocked: block};
      if (block !== 'unavailable') return null;
      result.data.priceCents = null;
      result.data.originalPriceCents = null;
      result.data.missing = result.data.missing.filter((field: string) => field !== 'price');
      return {...result, outcome: 'unavailable'};
    },
    deadlineResult(result: any, revealRule: any) {
      // The runtime rechecks pause/cancellation before authorizing the single click.
      if (!input.revealPrice && result.data.priceCents === null && revealRule) return {needsPriceReveal: true};
      return {outcome: 'technical_failure', reason: 'incomplete'};
    },
    value(node: Element, rule: any) {
      let value = (node as HTMLElement).innerText || node.textContent || '';
      if (rule.mode === 'attribute')
        value = node.getAttribute(rule.attribute) ?? '';
      if (rule.wholeSelector) {
        const whole = node
          .querySelector(rule.wholeSelector)
          ?.textContent?.replace(/\D/gu, '');
        const fraction = rule.fractionSelector
          ? node
              .querySelector(rule.fractionSelector)
              ?.textContent?.replace(/\D/gu, '')
          : '';
        value = whole ? whole + ',' + (fraction || '00') : '';
      }
      return value.trim();
    },
    image(data: any, value: string) {
      try {
        const image = new URL(value, document.baseURI);
        if (
          !value.trim() ||
          image.href.length > 2000 ||
          image.protocol !== 'https:' ||
          image.username ||
          image.password
        )
          return false;
        if (data.images.length < 80 && !data.images.includes(image.href))
          data.images.push(image.href);
        return true;
      } catch {
        return false;
      }
    },
    json(data: string, marker: string) {
      const at = marker ? data.indexOf(marker) : 0;
      if (at < 0) return null;
      const begin = data.slice(at + marker.length).search(/[[{]/u);
      if (begin < 0 || begin > 300) return null;
      const start = at + marker.length + begin;
      let depth = 0;
      const tokens = data.slice(start).matchAll(/"(?:[^"\\]|\\.)*"|[[\]{}]/gu);
      for (const token of tokens) {
        if (token[0].startsWith('"')) continue;
        if (token[0] === '[' || token[0] === '{') depth++;
        else if (--depth === 0)
          return JSON.parse(data.slice(start, start + token.index! + 1));
      }
      return null;
    },
    jsonImages(data: any, node: Element, rule: any) {
      try {
        const raw = rule.attribute
          ? (node.getAttribute(rule.attribute) ?? '')
          : (node.textContent ?? '');
        if (raw.length > 500000) return;
        let value = reader.json(raw, rule.jsonMarker || '');
        for (const key of (rule.jsonPath || '').split('.').filter(Boolean)) {
          if (!value || !Object.hasOwn(value, key)) return;
          value = value[key];
        }
        if (!Array.isArray(value)) return;
        for (const item of value.slice(0, 80))
          reader.jsonImage(data, item, rule);
      } catch {
        if (data.warnings.length < 1000)
          data.warnings.push('JSON de imagens inválido.');
      }
    },
    jsonImage(data: any, item: any, rule: any) {
      if (typeof item === 'string') {
        reader.image(data, item);
        return;
      }
      if (!item || typeof item !== 'object') return;
      for (const key of rule.imageProperties || []) {
        if (typeof item[key] === 'string' && reader.image(data, item[key]))
          break;
      }
    },
    imageNode(data: any, node: Element, rule: any, selector: string) {
      if (rule.mode === 'json') reader.jsonImages(data, node, rule);
      else if (rule.mode === 'attribute') {
        for (const attribute of [rule.attribute, ...(rule.attributes || [])]) {
          const value = node.getAttribute(attribute);
          if (value && reader.image(data, value)) break;
        }
      } else reader.image(data, reader.value(node, rule));
      if (data.evidence.length < 600)
        data.evidence.push({ field: 'images', selector });
    },
    specification(data: any, node: Element, rule: any) {
      const name = node.querySelector(rule.nameSelector || 'th')?.textContent,
        val = node.querySelector(rule.valueSelector || 'td')?.textContent;
      if (!name || !val || data.specifications.length >= 80) return;
      const pair = {
        name: reader.text(name, 150),
        value: reader.text(val, 600),
      };
      if (
        !data.specifications.some(
          (p: any) => p.name === pair.name && p.value === pair.value,
        )
      )
        data.specifications.push(pair);
    },
    category(data: any, categories: string[], value: string) {
      const parts = input.settings.categorySeparator
        ? value.split(input.settings.categorySeparator)
        : [value];
      for (const part of parts) {
        const clean = reader.text(part, 120);
        if (clean && categories.length < 30) categories.push(clean);
      }
      data.category = categories.at(-1)?.slice(0, 80) ?? '';
    },
    url(data: any, value: string) {
      try {
        const url = new URL(value, document.baseURI);
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          input.allowedOrigins.includes(url.origin)
        )
          data.productUrl = url.href;
      } catch {
        /* Retain the original URL. */
      }
    },
    fieldKey(field: string) {
      return (
        (
          {
            price: 'priceCents',
            originalPrice: 'originalPriceCents',
          } as Record<string, string>
        )[field] ?? field
      );
    },
    apply(
      data: any,
      categories: string[],
      rule: any,
      node: Element,
      selector: string,
    ) {
      if (rule.field === 'images') {
        reader.imageNode(data, node, rule, selector);
        return;
      }
      const value = reader.value(node, rule);
      if (!value && rule.mode !== 'pairs') return;
      switch (rule.field) {
        case 'specifications':
          reader.specification(data, node, rule);
          break;
        case 'category':
          reader.category(data, categories, value);
          break;
        case 'price':
        case 'originalPrice': {
          const key = reader.fieldKey(rule.field);
          if (data[key] === null) data[key] = reader.selectedMoney(value, rule.priceSelection);
          break;
        }
        case 'rating':
        case 'reviewCount':
          if (data[rule.field] === null)
            data[rule.field] = reader.reviewNumber(
              value,
              rule.field === 'reviewCount',
            );
          break;
        case 'productUrl':
          reader.url(data, value);
          break;
        default:
          if (!data[rule.field])
            data[rule.field] = reader.text(
              value,
              (
                {
                  title: 300,
                  brand: 120,
                  description: 4000,
                  conditions: 1500,
                  externalId: 100,
                } as Record<string, number>
              )[rule.field] ?? 300,
            );
      }
      if (data.evidence.length < 600)
        data.evidence.push({
          field: rule.field,
          selector,
        });
    },
    nodes(selector: string, data: any, field: string): Element[] {
      try {
        return Array.from(document.querySelectorAll(selector)).slice(0, 80);
      } catch {
        data.warnings.push('Seletor inválido para ' + field);
        return [];
      }
    },
    completeRule(data: any, categories: string[], rule: any) {
      if (rule.field === 'category') return categories.length > 0;
      if (rule.field === 'images' && rule.mode === 'json')
        return data.images.length > 0;
      if (['images', 'specifications'].includes(rule.field)) return false;
      return !!data[reader.fieldKey(rule.field)];
    },
    rule(data: any, categories: string[], rule: any) {
      if (
        rule.field === 'images' &&
        rule.imageSource === 'fallback' &&
        data.images.length
      )
        return;
      for (const selector of rule.selectors) {
        for (const node of reader.nodes(selector, data, rule.field))
          reader.apply(data, categories, rule, node, selector);
        if (reader.completeRule(data, categories, rule)) break;
      }
    },
    missing(data: any) {
      const fields = new Set([
        'title',
        'price',
        ...input.profile.rules
          .filter((r: any) => r.required)
          .map((r: any) => r.field),
      ]);
      for (const field of fields) {
        const value = data[reader.fieldKey(String(field))];
        if (
          value === null ||
          value === '' ||
          (Array.isArray(value) && !value.length)
        )
          data.missing.push(String(field));
      }
    },
    read() {
      const data: any = {
        title: '',
        brand: '',
        rating: null,
        reviewCount: null,
        priceCents: null,
        originalPriceCents: null,
        description: '',
        category: '',
        conditions: '',
        externalId: '',
        productUrl: input.originalUrl,
        images: [],
        specifications: [],
        warnings: [],
        missing: [],
        evidence: [],
        collectedAt: new Date().toISOString(),
      };
      const categories: string[] = [];
      for (const rule of input.profile.rules)
        reader.rule(data, categories, rule);
      reader.missing(data);
      if (
        data.originalPriceCents !== null &&
        data.priceCents !== null &&
        data.originalPriceCents <= data.priceCents
      )
        data.originalPriceCents = null;
      return {
        data,
        sourceCategoryPath: categories,
      };
    },
  };
  const revealRule = input.profile.rules.find((rule: any) => rule.field === 'price' && rule.priceReveal);
  let revealed = false;
  let end = Date.now() + input.settings.timeoutMs;
  let result = reader.read();
  while (true) {
    const state = reader.stateResult(result);
    if (state) return state;
    if (reader.canRequestReveal(result, revealRule)) return {needsPriceReveal: true};
    if (input.revealPrice && !revealed && result.data.priceCents === null) {
      if (!reader.revealPrice(revealRule)) return {outcome: 'technical_failure', reason: 'incomplete'};
      revealed = true;
      end = Date.now() + Math.min(15000, Math.max(100, Number(revealRule.priceReveal.waitTimeoutMs) || 8000));
      result = reader.read();
      continue;
    }
    if (!result.data.missing.length)
      return {
        ...result,
        outcome: 'success',
      };
    if (Date.now() >= end) return reader.deadlineResult(result, revealRule);
    await new Promise((r) => setTimeout(r, Math.min(250, Math.max(1, end - Date.now()))));
    result = reader.read();
  }
}
