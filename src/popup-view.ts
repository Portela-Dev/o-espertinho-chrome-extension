import type { Configuration, Progress, Account } from "./contracts.js";
export interface View {
  backendUrl: string;
  user?: Account;
  pairing: boolean;
  config?: Configuration;
  marketplaceId?: string;
  progress: Progress;
  queue?: {
    items: {
      id: string;
      title: string;
      state: string;
      affiliateUrl?: string;
      error?: string;
    }[];
  };
  version: string;
}
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
function renderAccount(view: View) {
  const connected = !!view.user;
  element("version").textContent = view.version;
  element("account").textContent = view.user?.email ?? "Conta desconectada";
  element("status").textContent = view.progress.message;
  element("mode").textContent = view.config?.mock
    ? "Ambiente demonstrativo"
    : "Conexão administrativa";
  element("login").hidden = connected;
  element<HTMLButtonElement>("login").disabled = view.pairing;
  element("logout").hidden = !connected && !view.pairing;
  element("logout").textContent = view.pairing ? "Cancelar conexão" : "Sair";
  element("workspace").hidden = !connected;
  const backend = element<HTMLInputElement>("backend");
  if (document.activeElement !== backend) {
    backend.value = view.backendUrl;
  }
  backend.disabled = connected;
  element<HTMLButtonElement>("save-backend").disabled = connected;
}
function renderMarketplaces(view: View, running: boolean) {
  const select = element<HTMLSelectElement>("marketplace");
  const selected = select.value || view.marketplaceId;
  const marketplaces = view.config?.marketplaces ?? [];
  if (
    JSON.stringify(Array.from(select.options, (option) => option.value)) !==
    JSON.stringify(marketplaces.map((m) => m.id))
  ) {
    select.replaceChildren(
      ...marketplaces.map((m) => {
        const option = document.createElement("option");
        option.value = m.id;
        option.textContent = m.name;
        return option;
      }),
    );
  }
  if (
    selected &&
    Array.from(select.options).some((option) => option.value === selected)
  ) {
    select.value = selected;
  }
  select.disabled = running;
  return select.value;
}
function renderProgress(view: View) {
  const processed = view.progress.success + view.progress.failed;
  const progress = element<HTMLProgressElement>("progress");
  progress.max = Math.max(1, view.progress.total);
  progress.value = processed;
  element("counts").textContent =
    `${processed} de ${view.progress.total} processados · ${view.progress.success} concluídos · ${view.progress.failed} falhas`;
  element("current").textContent = view.progress.currentTitle ?? "";
}
function resultLink(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return;
    }
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Ver link";
    return link;
  } catch {
    return undefined;
  }
}
function resultRow(item: NonNullable<View["queue"]>["items"][number]) {
  const row = document.createElement("li"),
    name = document.createElement("strong");
  name.textContent = item.title;
  row.append(name, document.createElement("br"));
  const detail = document.createElement("span");
  const labels: Record<string, string> = {
    pending: "Pendente",
    leased: "Em processamento",
    done: "Link gerado",
    failed: "Falhou",
  };
  detail.textContent = item.error ?? labels[item.state] ?? item.state;
  row.append(detail);
  if (item.affiliateUrl) {
    const link = resultLink(item.affiliateUrl);
    if (link) {
      row.append(" · ", link);
    }
  }
  return row;
}
export function renderView(view: View, busy: boolean) {
  const running = view.progress.status === "running";
  renderAccount(view);
  const marketplace = renderMarketplaces(view, running);
  element<HTMLButtonElement>("start").disabled =
    running || busy || !marketplace;
  element("start").textContent =
    view.progress.status === "paused"
      ? "Continuar geração"
      : "Gerar links pendentes";
  element<HTMLButtonElement>("pause").disabled = !running;
  element<HTMLButtonElement>("refresh").disabled = running;
  element<HTMLButtonElement>("reset").disabled = running;
  element("reset").hidden = !view.config?.mock;
  renderProgress(view);
  element("results").replaceChildren(
    ...(view.queue?.items ?? []).map(resultRow),
  );
}
