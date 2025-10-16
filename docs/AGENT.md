# Diretrizes para Agentes de IA

Este documento define padrões, boas práticas e instruções operacionais para criação, manutenção e revisão de agentes de IA dentro deste projeto.

> Última atualização: 2025-10-16

## 1. Objetivo

Padronizar o desenvolvimento, comportamento e manutenção dos Agentes de IA do projeto, garantindo conformidade com a arquitetura NestJS, princípios SOLID, Clean Code e demais convenções adotadas pela equipe.

## 2. Escopo

Aplica-se a qualquer código, documentação ou artefato produzido por agentes de IA que será integrado a este repositório. Inclui instruções operacionais internas dos agentes e templates para geração de código.

## 3. Requisitos de Conformidade (RF)

RF001 — Conformidade com Padrões do Projeto

- Seguir convenções de código, estrutura de diretórios e nomenclaturas existentes no projeto.
- Referenciar bibliotecas oficiais do NestJS presentes no projeto (por exemplo: `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/typeorm` etc.).
- Se não existir solução padrão no NestJS, propor alternativas baseadas em boas práticas de mercado, com justificativa técnica.

RF002 — Adoção de Princípios de Engenharia

- Aplicar SOLID e Clean Code: funções pequenas, responsabilidades únicas, nomes significativos e baixo acoplamento.
- Usar injeção de dependência do NestJS e separar responsabilidades entre Controller, Service, Repository/Provider.
- Evitar lógica de negócio em controllers; controllers devem orquestrar e delegar.

RF003 — Atualização Contínua da Documentação

- Ao alterar código, dependências ou convenções, atualizar `docs/AGENT.md` e sincronizar instruções internas dos agentes.
- Documentar a alteração com data, autor e breve justificativa no bloco de histórico deste arquivo.

## 4. Requisitos Não Funcionais

- Padronização: respeitar padrões definidos pelo time técnico.
- Manutenibilidade: gerar código legível, modular e testável (ex.: unit tests para services).
- Escalabilidade: projetar agentes com interfaces estáveis e extensíveis.
- Documentação: incluir exemplos, contratos (inputs/outputs) e links para referências externas.

## 5. Contrato de Implementação (Exemplo)

Use este mini-contrato para orientar implementações de agentes que geram ou executam código:

- Inputs: { context: object, spec: string, repoPath?: string }
- Outputs esperados: { filesCreated: string[], filesUpdated: string[], testsAdded?: string[], changelog: string }
- Mecanismos de erro: comunicar falhas com mensagens estruturadas e códigos (ex.: `VALIDATION_ERROR`, `IO_ERROR`).

### Exemplos de Edge Cases

- Repositório sem TypeORM configurado: sugerir `@nestjs/sequelize` ou `Prisma` com justificativa.
- Mudança em dependência major: incluir plano de migração e testes automatizados.
- Arquivo de configuração ausente: indicar local padrão (`/config` ou `src/config`) e oferecer template.

## 6. Regras de Negócio (RB)

- RB001: Nenhum agente poderá ser implantado sem validação de conformidade com este documento.
- RB002: Alterações ao `docs/AGENT.md` devem ser revisadas por um membro técnico responsável antes de aceitar o PR.
- RB003: Instruções internas dos agentes devem sempre incluir exemplos práticos e referências a módulos existentes.

## 7. Exceções

- Projetos que utilizam tecnologias fora do ecossistema NestJS podem receber propostas específicas, desde que documentadas e aprovadas tecnicamente.

## 8. Dependências (recomendadas)

- Framework: NestJS
- Linguagem: TypeScript
- Padrões: SOLID, Clean Code, Arquitetura em Camadas
- Diretórios: `/docs`, `/config`, `src/` com camadas Controller/Service/Repository

## 9. Checklist de Entrega do Agente

Antes de abrir PR, verifique:

1. [ ] Segue convenções do projeto (lint, tsconfig, paths).
2. [ ] Camadas separadas: controller → service → repository/provider.
3. [ ] Injeção de dependência usada corretamente.
4. [ ] Cobertura mínima de testes unitários para a lógica de negócio.
5. [ ] Atualização de `docs/AGENT.md` se aplicável.
6. [ ] Adicionado CHANGELOG/COMMIT descrevendo a mudança e referência a este documento.

## 10. Template de Instruções Internas do Agente

Use o template abaixo quando configurar o comportamento interno de um agente (por exemplo, um prompt ou uma função geradora):

---
Título: <Nome do Agente>

Propósito: <Breve descrição do objetivo do agente>

Entrada: (shape/type) — Descrever os campos esperados

Saída: (shape/type) — Descrever o que o agente retorna e o formato

Passos:

1. Validar entrada (tipos, obrigatoriedade, limites).
2. Mapear requisitos para o padrão do projeto (ex.: localizar pastas `src/`, `config/`).
3. Gerar/alterar arquivos seguindo o contrato e padrões (imports absolutos/relativos conforme tsconfig).
4. Executar testes unitários locais (se houver) e coletar resultados.
5. Gerar changelog e instruções de deploy/migração.

Restrições de Segurança/Privacidade:

- Não exfiltrar segredos (chaves/credentials). Se detectado, instruir a mover para `process.env` e `@nestjs/config`/Vault.

Referências:

- NestJS docs: https://docs.nestjs.com/
- TypeScript handbook: https://www.typescriptlang.org/
- Clean Code (Robert C. Martin)

---

## 11. Exemplo prático: Criando um Agent Service (esqueleto)

Exemplo rápido de como um agente poderia ser integrado no projeto (apenas esqueleto):

1. Criar `src/agents/agent.module.ts` que exporta providers.
2. Implementar `AgentService` em `src/agents/agent.service.ts` com métodos testáveis.
3. Evitar lógica side-effect em construtores; usar métodos async.

Exemplo de responsabilidades do `AgentService`:

- parseSpec(spec: string): ParsedSpec
- generateFiles(parsed: ParsedSpec, targetPath: string): Promise<GenerationResult>
- runLocalTests(targetPath: string): Promise<TestReport>

## 12. Processo de Revisão e Merge

- Abrir PR com título claro e descrição ligada a `docs/AGENT.md`.
- Incluir checklist preenchida no PR.
- Um membro técnico deve revisar e aprovar conforme RB002.

## 13. Histórico de Atualizações

- 2025-10-16 — Criação inicial do documento (autor: agente automatizado). Verificar RB002 para revisão humana.

## 14. Próximos Passos/Recomendações

- Implementar um template de `AgentService` no repositório (`src/agents`) como referência.
- Automatizar checagens: lint, tests e validação de contrato (por exemplo, um script `npm run agent:validate`).

---

Se houver mudanças relevantes na arquitetura ou nas dependências, atualize este arquivo e marque o item correspondente no CHANGELOG do repositório.
