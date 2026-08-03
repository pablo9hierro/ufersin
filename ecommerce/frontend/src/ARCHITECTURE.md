# Arquitetura Frontend ↔ Backend

Contrato único entre a camada visual e o backend — nenhuma página ou
componente fala com `lib/api` (o ApiClient) diretamente. Objetivo: trocar
o Design System inteiro (Sunset clone vs `uiux2/` nativo, e qualquer tema
futuro vendido a um tenant) sem tocar em nenhuma regra de negócio.

## Fluxo

```
Página/Componente → hooks/useX() ou services/xService → api/endpoints/x.ts
  (valida a resposta com Zod) → lib/api.ts (ApiClient existente,
  Proxy demo/produção) → Backend (Supabase RPC / Rust-Railway / Vercel Edge)
```

- **`api/endpoints/*`** — único lugar autorizado a importar `lib/api`. Um
  arquivo por módulo de negócio (products, coupons, orders, admin, motoboy,
  pdv...). Cada função valida a resposta com Zod antes de devolver.
- **`types/*`** — o contrato em si: um schema Zod por domínio + o tipo TS
  derivado (`z.infer`). Substitui o antigo `lib/types.ts` — não existe mais
  interface escrita à mão em paralelo a um schema.
- **`services/*`** — o que páginas chamam para mutações/ações (criar
  pedido, aplicar cupom, login, CRUD de admin). Repassa pra `api/endpoints`
  sem reimplementar nada.
- **`hooks/*`** — o que páginas chamam para leitura em mount (catálogo,
  promoções, pedidos do cliente). Todos construídos em cima de
  `hooks/useAsync.ts`, o primitivo genérico que substituiu o bloco
  `useState+useEffect+.then+.finally` repetido em quase toda tela.
- **`lib/api.ts`** — o ApiClient em si (mantido onde estava): já resolvia
  sozinho entre Supabase direto, backend Rust/Railway e o modo demo
  (`localApi.ts`, via Proxy) — esse mecanismo não mudou, só passou a ser
  chamado só por `api/endpoints/*`, nunca mais por uma página.
- **`store/*`** (Zustand) — é a camada de `providers/` desta stack: estado
  global, sem prop-drilling, sem Context API por cima (seria duplicar
  mecanismo). Nenhuma store chama a API — só guarda o que os
  services/hooks escrevem nela.

## Validação de contrato (Zod)

`api/validate.ts` roda `schema.safeParse()` em toda resposta. Se não
bater, loga um erro visível no console (não silencioso) e devolve o dado
como veio, sem lançar exceção — o objetivo é avisar alto quando o backend
mudar um contrato, sem transformar isso num novo modo de falha em
produção.

## Separação de estado

| Categoria | Onde mora | Exemplos |
|---|---|---|
| Global persistente | `store/*.ts` (Zustand + `persist`) | `cart`, `customerAuth`, `adminAuth`, `motoboyAuth`, `vendedorAuth`, `demoPalette`, `layoutStyle` |
| Servidor (fetch) | `hooks/use*.ts` | catálogo, promoções ativas, cupons do cliente, pedidos, configurações do site |
| Local de página | `useState` dentro da própria página | inputs de formulário, abas abertas, modais, filtros |
| Temporário/sessão de aba | `sessionStorage` (`lib/demoMode.ts`) | flag de modo demonstração |

## Preparado para múltiplos layouts

`pages/*` (clone Sunset) e `uiux2/pages/*` (nativo Ufersin) são duas
implementações visuais **diferentes** que consomem exatamente os mesmos
`services/`/`hooks/` — prova viva de que o contrato já está desacoplado da
apresentação. Um tema novo (ex.: "Farmácia", "Restaurante") é só mais uma
pasta de páginas/componentes chamando os mesmos hooks/services; zero
mudança em `api/`, `services/`, `hooks/` ou `types/`.

## Contrato obrigatório — landing + CMS do lojista

A especificação canônica das páginas de cliente (HTML + dinâmicas
obrigatórias) é:

`FRONTEND_FUNCTIONAL_SPECIFICATION.txt`
(cópia espelhada de `juite/frontend/FRONTEND_FUNCTIONAL_SPECIFICATION.txt`)

Resumo das regras adicionadas/atualizadas nessa spec:

1. **Horário** — botão sempre visível + painel com X; fonte `store_hours`.
2. **Logo** — upload em `/meu-plano/layout` → header home com nome.
3. **Textos do hero** — CMS preview 1:1 em `/meu-plano/layout`.
4. **CartFab** — sacola ou `#cart-icon` (+ animate); inferior direita.
5. **Loja fechada** — landing cinza + banner; checkout bloqueado.
6. **Rotas do hub** — `/meu-plano`, `/meu-plano/layout`, `/financeiro`, `/redes`.
7. **Auth plataforma** — storage keys separadas lojista/superadmin.

## Fora de escopo desta rodada

- Testes automatizados novos (a base ficou testável — services/hooks são
  funções puras fáceis de mockar — mas a suíte em si não foi escrita).
