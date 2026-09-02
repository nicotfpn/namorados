# Nossas Noites Temáticas

Site e app das nossas noites: convite, cardápio, fotos e filmes.

## Onde fica cada coisa

- `index.html`: conteúdo da página.
- `css/` e `js/`: aparência e funcionamento.
- `assets/images/`: fotos, cardápio, Pokémon e imagens do ratinho.
- `assets/icons/`: ícones de girassol para celular e computador. O arquivo `girassol-original.png` é a arte em tamanho original, para exportar novos tamanhos se precisar.
- `api/reviews.js`: salva e consulta os filmes na Vercel.
- `tests/`: verifica se adicionar, editar e excluir filmes funciona.
- `manifest.json` e `sw.js`: instalação no celular e funcionamento offline.
- `electron-main.js` e `electron-preload.js`: versão para computador.
- `build.mjs`, `package.json`, `package-lock.json` e `vercel.json`: dependências, geração e publicação.

## Usar o projeto

Instalar dependências: `npm ci`.

Gerar o site: `npm run build`.

Verificar os filmes: `npm test`.

Abrir a versão de computador: `npm start`.

Gerar instaladores: `npm run build:win` ou `npm run build:linux`. A geração inclui os arquivos do site antes de empacotar o app.

## Pastas geradas

- `node_modules/`: dependências para desenvolver e gerar o app.
- `dist/`: arquivos compactados usados pela página; são recriados pelo comando de geração.
- `release/`: instaladores, criados apenas ao empacotar a versão de computador.

Essas pastas não entram no Git. `.git/` guarda o histórico do projeto.

## Vercel e dados

A Vercel executa `npm run build`. A API dos filmes usa `KV_REST_API_URL` e `KV_REST_API_TOKEN`, configurados no painel da Vercel. Não salve esses valores no projeto.

A seção Nossa história foi removida. A limpeza dos arquivos locais não apaga os registros já guardados no banco.
