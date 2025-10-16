# Contribuindo — WABR API

Obrigado por querer contribuir! Siga as diretrizes abaixo para facilitar a revisão e integração de PRs.

Como contribuir
1. Fork o repositório e crie uma branch a partir de `main` com um nome descritivo:
   `feature/descrição` ou `fix/descrição`.
2. Instale dependências e rode testes (quando existirem):
   ```powershell
   npm install
   npm run lint
   ```
3. Faça commits pequenos e com mensagens claras.
4. Abra um PR descrevendo a mudança, motivo e possíveis impactos.

Padrões
- TypeScript com `strict: true`.
- Linter: ESLint, siga `npm run lint`.
- Não formate automaticamente arquivos não relacionados no mesmo PR.

Sugestões de tarefas
- Implementar testes unitários (Jest)
- Adicionar migrations do TypeORM
- Melhorar a segurança do armazenamento de tokens

Contato
- Abra issues para discutir mudanças maiores antes de começar a implementação.

Fim.
