# ufersin

Página de assinatura da plataforma ufersin — onde o dono de uma loja assina o
plano mensal e autoriza a cobrança recorrente via Mercado Pago. Essa é a
PLATAFORMA (o "SaaS de fábrica de sites"), não um site de loja específico —
sites de cliente (como o Sunset Tabas) continuam em repositórios próprios.

## Stack

- `frontend/`: Vite + React + TS + Tailwind v4 — página de assinatura +
  página de status pós-checkout.
- `backend/`: Rust + Axum + SQLx — cria a assinatura recorrente no Mercado
  Pago e guarda o cadastro do lojista.
- Banco: **mesmo projeto Supabase** já usado por sunset/vrtech/juete, num
  schema próprio (`ufersin`) — isolado dos outros por `search_path`, sem
  precisar de um projeto Supabase novo.

## Como funciona a assinatura

1. Lojista preenche o formulário em `/` (nome da loja, responsável,
   WhatsApp, e-mail).
2. Backend cria o registro em `ufersin.subscribers` e chama a API do
   Mercado Pago (`POST /preapproval`, com `auto_recurring` embutido e
   `status: "pending"`) — isso devolve um `init_point`, o link do checkout
   HOSPEDADO pelo Mercado Pago.
3. Frontend redireciona o lojista pra esse link. O Mercado Pago coleta
   cartão/Pix/etc — a gente nunca lida com dado de pagamento diretamente
   (fora do escopo de PCI compliance).
4. Mercado Pago manda o lojista de volta pra `/obrigado?id=<id>`, que fica
   consultando `GET /api/assinaturas/:id/status` (polling, mesmo padrão já
   usado no Pix do Sunset Tabas) até o status virar `ativo`.

Não tem webhook — o formato de webhook do Mercado Pago varia por produto e
é uma fonte de bug difícil de depurar às cegas; polling é mais simples e
robusto pro volume que essa página tem.

## Setup

### 1. Banco (Supabase — mesmo projeto dos outros sites)

Não precisa rodar SQL manual: `cargo run` (ou o deploy no Railway) cria o
schema `ufersin` e roda as migrations sozinho na primeira vez que sobe,
igual o backend do Sunset Tabas já faz.

### 2. Mercado Pago

Precisa de uma conta Mercado Pago com o produto **Assinaturas/Preapproval**
aprovado (é diferente de só aceitar Pix avulso — confirme no painel deles,
em "Suas integrações", que esse produto está disponível pra sua conta antes
de configurar `MP_ACCESS_TOKEN` em produção). Sem o token configurado, o
backend roda em modo mock (não cobra nada de verdade, só testa o fluxo).

### 3. Backend (`backend/.env`, copie de `.env.example`)

```
DATABASE_URL=<mesma connection string do projeto Supabase compartilhado>
MP_ACCESS_TOKEN=<token de produção ou teste do Mercado Pago>
PLANO_VALOR_MENSAL=99.00
BACK_URL=https://ufersin.vercel.app/obrigado
CORS_ORIGINS=https://ufersin.vercel.app
```

```bash
cd backend
cargo run
```

### 4. Frontend (`frontend/.env`, copie de `.env.example`)

```
VITE_API_BASE_URL=https://<seu-backend>.up.railway.app
```

```bash
cd frontend
npm install
npm run dev
```

## Deploy

- **Backend**: Railway (Nixpacks builda o Rust sozinho a partir do
  `Cargo.toml`). Configure as env vars da seção 3 direto no Railway.
- **Frontend**: Vercel, apontando `frontend/` como root do projeto
  (`vercel.json` já tem o `rewrites` pra SPA). Configure
  `VITE_API_BASE_URL` nas env vars do projeto Vercel.

⚠️ **Vercel Hobby (grátis) não permite uso comercial** — assim que isso
virar operação real com clientes pagantes, migre pro plano Pro.
