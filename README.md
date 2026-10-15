# TotoReal

**Link:** https://salvyri.github.io/totoreal/

O totoloto semanal do Realense FC. Todas as semanas cada jogador marca 1, X ou 2 nos jogos da Série A da 1.ª Distrital AF Braga, sem contar o jogo do Realense. Só ganha quem acertar em todos.

## Regras que a app aplica

- **Abertura:** cada jornada abre na segunda-feira da semana dos jogos. Só se joga a jornada atual.
- **Prazo:** sexta-feira às 21:00. Se algum jogo do TotoReal começar antes disso, o prazo passa para as 12:30 do dia desse jogo. O admin pode mudar a abertura e o prazo de qualquer jornada.
- **Jogo adiado:** o admin marca-o como "Anulado" e esse jogo deixa de contar nessa jornada.
- **Vencedor:** quem acertar em todos os jogos que contam. Se ninguém acertar, ninguém ganha.
- **Palpites dos outros:** ficam escondidos até saírem os resultados e depois toda a gente os vê.
- **Classificação:** há duas tabelas. "Mais vencedores" conta as jornadas ganhas e "Mais certeiros" conta o total de jogos acertados.
- **Contas:** entra-se com email e palavra-passe e cada pessoa escolhe um nome público, que não pode estar repetido.
- **Admin:** vê os emails e os boletins de toda a gente, cria e edita jornadas, lança resultados, bloqueia jogadores e apaga contas.

O calendário das 30 jornadas já vem carregado (fonte: resultados.fpf.pt). Os horários das jornadas mais à frente podem mudar, por isso convém confirmá-los no site da FPF antes de cada jornada.

## Configuração
A app usa o projeto Firebase `totoreal-7348a` (contas por email e Firestore) e está alojada no GitHub Pages a partir da raiz do ramo `main`. As regras de segurança estão em `firestore.rules` e colam-se em Firestore > Regras na consola do Firebase.

### Primeira utilização
1. Abre o link, cria a tua conta e carrega em **Ficar como administrador**. Faz isto antes de partilhares o link, porque fica administrador quem carregar primeiro.
2. Em **Admin**, importa o calendário a partir da jornada que quiseres (por exemplo a 2).
3. Partilha o link no grupo da equipa.

## Todas as semanas (admin)
1. Antes de segunda-feira, confirma os horários no site da FPF e corrige-os em **Admin > Editar** se mudaram.
2. Depois dos jogos, abre a jornada, marca o resultado de cada jogo (1, X, 2 ou Anulado) e carrega em **Publicar resultados**.

## Ficheiros
- `index.html`, `app.js`: a app.
- `calendario.js`: o calendário das 30 jornadas.
- `config.js`: a configuração da app web do Firebase. Não é secreta.
- `firestore.rules`: as regras de segurança da base de dados.
- `testes/`: os testes das regras e o percurso completo no browser, que correm contra o servidor de teste do Firebase.

## Como testar localmente
Com `firebase-tools` instalado, troca o `projectId` em `config.js` por `"demo-totoreal"` e corre `firebase emulators:start --only auth,firestore,hosting --project demo-totoreal`. A app fica em http://127.0.0.1:5000.
