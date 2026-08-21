# Deploy troubleshooting — erros já caçados nesta plataforma

Cada item aqui já causou produção quebrada ou horas perdidas de investigação
**mais de uma vez**. Antes de tratar um deploy quebrado como mistério, checar
esta lista primeiro.

---

## 1. vrtech (`caralho`) — Vercel: `MIDDLEWARE_INVOCATION_FAILED` / "Invalid supabaseUrl" derruba o site INTEIRO

**Sintoma:** 500 em toda rota, incluindo páginas públicas que nem usam sessão
(vitrine, home). Console mostra `Invalid supabaseUrl: Must be a valid HTTP or
HTTPS URL.`

**Causa raiz (duas variantes, ambas já aconteceram):**
1. `src/middleware.ts` roda no matcher de **todas** as rotas só pra renovar a
   sessão da plataforma via `createServerClient`. Se
   `NEXT_PUBLIC_RESOLUTOO_SUPABASE_URL`/`_ANON_KEY` estiverem ausentes ou
   inválidas no bundle, o construtor do client lança e — sem guarda — isso
   vira 500 em TUDO, não só em rotas que precisam de sessão.
2. A env var em si fica **corrompida no dashboard do Vercel** (não no
   `.env.local`) — motivo exato ainda não determinado (edição manual, sync
   de outra ferramenta, etc). `vercel env ls` mostra a var "presente" mas o
   valor lido em runtime falha o `.startsWith('http')`.

**Fix permanente (já aplicado):** `src/middleware.ts` valida
`platformUrl?.startsWith('http')` e `platformKey` ANTES de construir o
client; se inválido, loga erro e segue a request sem renovar sessão (rotas
que exigem login caem no `/login` normalmente; o resto do site continua de
pé). `getUser()` também ganhou try/catch — instabilidade de rede com o
Supabase não pode virar 500 global.

**Se voltar a acontecer:**
```bash
cd caralho
# 1. Confirma que a env var no Vercel bate com o valor real
npx vercel env ls production | grep RESOLUTOO

# 2. Se suspeitar de corrupção, reescreve do zero (nunca edita in-place)
npx vercel env rm NEXT_PUBLIC_RESOLUTOO_SUPABASE_URL production --yes
cat .env.local | grep NEXT_PUBLIC_RESOLUTOO_SUPABASE_URL= | cut -d= -f2- | npx vercel env add NEXT_PUBLIC_RESOLUTOO_SUPABASE_URL production
# idem pra NEXT_PUBLIC_RESOLUTOO_SUPABASE_ANON_KEY

# 3. NEXT_PUBLIC_* só entra no bundle em BUILD TIME -- reescrever a env
#    var sozinha não conserta nada até redeployar:
npx vercel --prod --yes --force
```

---

## 2. `ufersin/frontend` — deploy "não vai pro ar" apesar de `git push`

**Sintoma:** código commitado e pushado pra `main`, mas `resolutoo.com`
continua servindo a versão antiga. `npx vercel ls` mostra o deploy mais
recente com idade de horas, sem nenhum novo depois do push.

**Causa raiz:** o projeto Vercel `ufersin` **não dispara deploy automático
em push do GitHub** (motivo exato não confirmado — pode ser integração
desconectada, pode nunca ter sido conectada). Só existe `.vercel/project.json`
local. `git push` sozinho NÃO é suficiente aqui — diferente de outros
projetos desta plataforma.

**Fix:** deploy manual via CLI é obrigatório após todo push relevante:
```bash
cd ufersin   # RAIZ do monorepo -- ver item 3 sobre por que não pode ser frontend/
npx vercel --prod --yes
```

---

## 3. `ufersin/frontend` — CLI deploy da subpasta `frontend/` falha com `scripts/embed-loja-demo.sh missing`

**Sintoma:** `Error: Command "test -f scripts/embed-loja-demo.sh || ... exit
127"` mesmo com o arquivo existindo em `frontend/scripts/`.

**Causa raiz:** `frontend/.vercel/project.json` tem `"rootDirectory":
"frontend"`. Rodar `vercel --prod` de DENTRO de `frontend/` faz o Vercel
aplicar o rootDirectory por cima do cwd, procurando
`frontend/frontend/scripts/...` — path duplicado, path que não existe.

**Fix:** sempre deployar a partir da **raiz do monorepo** (`ufersin/`), nunca
de dentro de `frontend/`:
```bash
cd ufersin   # não cd ufersin/frontend
npx vercel --prod --yes
```

---

## 4. `ufersin` (raiz) — `vercel --prod` local estoura memória (`JavaScript heap out of memory`) só empacotando o upload

**Sintoma:** CLI trava em "Deploying…" e crasha com `FATAL ERROR: Committing
semi space failed` — acontece ANTES do build remoto começar, na fase de
empacotar os arquivos locais pra upload.

**Causa raiz:** sem um `.vercelignore` na raiz do monorepo, o CLI escaneia
`backend/target` (build Rust), `ecommerce/backend/target`, `node_modules` de
3+ projetos diferentes — gigabytes de arquivo que não têm nada a ver com o
deploy do frontend.

**Fix (já aplicado):** `.vercelignore` na raiz excluindo `node_modules`,
`*/target`, `.migration-tmp`, logs, etc. Se voltar a acontecer, checar se
algum diretório novo e pesado precisa entrar na lista.

---

## 5. `ufersin/frontend` — build remoto falha com `set: pipefail: invalid option name`

**Sintoma:** `scripts/embed-loja-demo.sh: line 6: set: pipefail: invalid
option name`, exit code 2 — acontece no build REMOTO (Linux, container do
Vercel), não localmente no Windows.

**Causa raiz:** o container de build do Vercel resolve `bash` pra um shell
que não reconhece `set -o pipefail` (provavelmente uma variante minimalista,
não bash real, apesar do nome). O script não usa nenhum pipe (`|`) onde essa
proteção faria diferença — era `set -euo pipefail` por hábito, não por
necessidade real.

**Fix (já aplicado):** trocado pra `set -eu` em
`frontend/scripts/embed-loja-demo.sh`. **Regra geral pra scripts novos desta
plataforma:** não usar `pipefail` a menos que o script realmente dependa de
falha em pipe — testar sempre num deploy real antes de assumir que compila.

---

## 6. `ufersin/frontend/scripts/*.sh` — CRLF do checkout Windows quebra o script no Linux

**Sintoma:** erros bizarros tipo ``cd: $'/vercel/path0/frontend/scripts\r/..':
No such file or directory`` ou ``$'\r': command not found`` — os `\r`
(carriage return) literais aparecem  DENTRO de paths e comandos.

**Causa raiz:** `git config core.autocrlf` está `true` neste ambiente
Windows. Isso converte LF→CRLF **no checkout local** (disco), mesmo que o
blob no git esteja limpo em LF. `vercel --prod` via CLI empacota os bytes do
**disco local diretamente** — não passa pelos objetos git — então CRLF
reintroduzido pelo checkout vai direto pro deploy, mesmo que `git diff`
mostre "nada mudou".

**Fix (já aplicado):**
1. `.gitattributes` na raiz ganhou `*.sh text eol=lf` — força LF no
   checkout independente de `core.autocrlf`.
2. Se algum `.sh` for editado e o deploy voltar a quebrar com `\r` nos
   logs, normalizar o arquivo em disco antes de deployar:
   ```bash
   node -e "const fs=require('fs');const p='CAMINHO/DO/SCRIPT.sh';let s=fs.readFileSync(p,'utf8');s=s.replace(/\r\n/g,'\n').replace(/\r/g,'\n');fs.writeFileSync(p,s)"
   ```
3. **Nunca confiar em `git diff --stat` mostrando "0 mudanças" como prova de
   que o arquivo em disco está limpo** — o diff compara contra o blob (que
   pode já estar normalizado), não contra o que o CLI vai de fato ler do
   disco.

---

## 7. Railway GraphQL — `Not Authorized` com token que não expirou

**Sintoma:** script contra `https://backboard.railway.com/graphql/v2` volta
`"Not Authorized"` em toda query, mesmo lendo o token de
`~/.railway/config.json` e confirmando que `tokenExpiresAt` ainda está no
futuro.

**Causa raiz:** o Railway CLI **rotaciona o nome do campo** no config —
às vezes é `user.token`, às vezes `user.accessToken`, dependendo da versão/
momento da rotação interna do CLI. Um script que só lê `user.token` manda
`Authorization: Bearer undefined` e a API devolve um erro genérico de auth
em vez de reclamar do header malformado.

**Fix:** todo script novo que autentica contra a API do Railway deve aceitar
os dois nomes:
```js
const u = JSON.parse(readFileSync(configPath, 'utf8')).user
const token = u.accessToken || u.token
if (!token) throw new Error('sem token no config do railway')
```

---

## 8. `ecommerce-api` (Railway, GitHub-linked) — `railway up` "funciona" mas não muda nada

Já documentado em memória (`project_ufersin_api_deploy_pipeline.md`) —
resumo: o serviço é linkado ao GitHub e redeploya automaticamente a cada
push, o que pode RACEAR com um `railway up` manual e sobrescrever com HEAD
antigo se houver commits locais não pushados. **Sempre `git push` antes de
investigar por que um deploy "não pegou".**

---

## 9. vrtech (`caralho`) — o mesmo crash "Invalid supabaseUrl" volta mesmo com env var correta e sem `.vercel/output` local

**Sintoma:** depois de reescrever a env var certinha (item 1) e confirmar
que o build LOCAL (`npm run build`, checar `.next/server/`) tem a URL
inlinada corretamente, o deploy remoto ainda serve o crash. Redeployar de
novo (mesmo comando, nenhuma mudança) resolve.

**Causa:** aparenta ser flakiness genuína do build remoto do Vercel — às
vezes ele resolve a env var errado numa passada específica, sem relação
com cache local (já confirmado ausente) nem com o valor real da env var
(já confirmado correto via `vercel env pull` + checagem do bundle local).
Não achei uma causa determinística ainda.

**Mitigação:** depois de QUALQUER deploy de `caralho`, sempre confirmar
com curl antes de considerar terminado:
```bash
curl -sD - -o /dev/null "https://vrtech-jp.vercel.app/dashboard"
# Esperado: HTTP/1.1 307 (redirect pro login, sessão ausente = normal)
# Se vier 200 com "crash"/"Invalid supabaseUrl" no body -> redeployar de novo:
rm -rf .vercel/output && npx vercel --prod --yes --force
```
Nunca declarar um deploy de `caralho` concluído só porque o comando
retornou sucesso — **sempre** curl o `/dashboard` depois.

---

## Checklist rápido antes de declarar "deploy não funciona"

1. O código foi **pushado** pro GitHub? (`git status`, `git log origin/main..HEAD`)
2. Esse projeto Vercel/Railway **realmente** auto-deploya em push, ou precisa
   de comando manual? (checar `npx vercel ls` / `railway deployment list`
   por idade do deploy mais recente vs. horário do push)
3. Deploy manual está sendo disparado do diretório certo? (raiz do monorepo,
   não da subpasta, quando `rootDirectory` está configurado)
4. Algum script `.sh` tocado recentemente tem CRLF no disco? (`grep -c $'\r'
   caminho/do/script.sh`)
5. Env vars `NEXT_PUBLIC_*` mudaram? Lembrar que exigem **rebuild**, não só
   re-set — `vercel env add` sozinho não afeta um bundle já buildado.
6. Middleware/código que roda em TODA rota tem guarda contra env ausente/
   inválida? Um crash ali derruba páginas que não têm nada a ver com o bug.
