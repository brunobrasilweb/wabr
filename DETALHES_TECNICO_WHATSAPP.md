# Detalhes Técnicos - Sincronização de Status WhatsApp

## Diagrama de Estado da Sessão

```
┌──────────────┐
│              │
│   (inicial)  │
│              │
└──────┬───────┘
       │
       ├─────────────────────────────────────────────────────┐
       │                                                       │
       ▼                                                       ▼
   [criando DB]                                         [erro ao criar]
       │                                                       │
       ├─────────────────────────────────────────────────────┤
       │                                                       │
       ▼                                                       ▼
  sessionStatus='reconnecting'           sessionStatus='disconnected'
       │
       ├─ baileys.createSession()
       │  (socket criado, listeners ativo)
       │
       ├─ Usuário escaneia QR
       │  (QR enviado para cliente)
       │
       ├─ connection.update['open']
       │  (evento 'connected' emitido)
       │
       ▼
  sessionStatus='connected' ◄────────────────────────────────────┐
       │                                                         │
       ├─ Mensagens podem ser enviadas                          │
       │                                                         │
       ├─ connection.update['close'] ──────────────────────────┤
       │  (reconexão tentada até 3x)                           │
       │                                                         │
       └─────────────────────────────────────────────────────────
              (após max retry ou logout)
```

## Fluxo Detalhado de Eventos

### Fase 1: Inicialização da Aplicação
```typescript
// WhatsappService.onModuleInit() é chamado quando módulo inicia
// Listeners são REGISTRADOS aqui, ANTES de qualquer sessão existir
baileys.events.on('connected', handleConnected);
baileys.events.on('disconnected', handleDisconnected);
```

**Importância**: Listeners devem estar prontos ANTES de qualquer evento ser emitido. Caso contrário, eventos se perdem no vazio.

### Fase 2: Criar Conexão
```typescript
// POST /api/whatsapp/connect
async createConnection(userId: string, phoneNumber: string) {
  // ✅ CRÍTICO: Criar DB ANTES de criar sessão Baileys
  const conn = repo.create({ userId, phoneNumber, status: 'reconnecting' });
  await repo.save(conn); // DB record agora existe
  
  // ✅ Agora Baileys pode emitir eventos
  const session = await baileys.createSession(userId, phoneNumber);
}
```

**Fluxo**:
1. DB record é criado com `status='reconnecting'`
2. `baileys.createSession()` é chamado
3. Socket Baileys é criado
4. QR é gerado (se necessário)
5. Usuário escaneia QR
6. Baileys conecta ao WhatsApp

### Fase 3: Receber Evento Connected
```typescript
// Dentro de connection.update handler do Baileys
if (connection === 'open') {
  // Socket está conectado ao WhatsApp
  // Salvar credenciais
  await saveCreds();
  
  // Ler arquivo creds.json
  const fileContents = await readFile(credsPath);
  
  // ✅ EMITIR EVENTO para que listeners atualizem DB
  events.emit('connected', { userId, sessionId, fileContents, phoneNumber });
}
```

### Fase 4: Listener Atualiza DB
```typescript
// Em WhatsappService.onModuleInit()
baileys.events.on('connected', async (payload) => {
  const { userId, sessionId, fileContents } = payload;
  
  // ✅ Buscar record que foi criado em Fase 2
  const existing = await repo.findOne({ where: { userId } });
  
  if (existing) {
    // ✅ Atualizar status para 'connected'
    existing.sessionStatus = 'connected';
    existing.sessionData = { raw: fileContents };
    await repo.save(existing);
    
    logger.log(`Session ${userId} now CONNECTED`);
  }
});
```

## Tratamento de Reconexão

### Cuando Baileys Desconecta
```typescript
if (connection === 'close') {
  const statusCode = update?.lastDisconnect?.error?.output?.statusCode;
  const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
  
  if (shouldReconnect && reconnectAttempts < 3) {
    // Tentativa 1: espera 2s
    // Tentativa 2: espera 4s  
    // Tentativa 3: espera 6s
    // Após isso: marca como disconnected
    
    reconnectAttempts++;
    const backoff = 2000 * reconnectAttempts;
    setTimeout(() => createSocket(), backoff);
  } else {
    // ✅ Emitir evento para atualizar DB
    events.emit('disconnected', { userId, sessionId, statusCode });
  }
}
```

### Listener Desconexão Atualiza DB
```typescript
baileys.events.on('disconnected', async (payload) => {
  const { userId } = payload;
  
  const existing = await repo.findOne({ where: { userId } });
  if (existing) {
    // ✅ Atualizar status para 'disconnected'
    existing.sessionStatus = 'disconnected';
    existing.sessionData = null;
    await repo.save(existing);
    
    logger.log(`Session ${userId} now DISCONNECTED`);
  }
});
```

## Envio de Mensagem com Validação

### Verificação de Status
```typescript
// WhatsappService.sendText()
async sendText(userId: string, to: string, text: string) {
  const existing = await repo.findOne({ where: { userId } });
  
  if (!existing) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  
  // ✅ CRUCIAL: Verificar se está REALMENTE conectado
  if (existing.sessionStatus !== 'connected') {
    return { ok: false, error: 'NOT_CONNECTED' };
  }
  
  // Proceder com envio
  const result = await baileys.sendMessage(userId, to, text);
  return result;
}
```

### Resposta no Controller
```typescript
// WhatsappController.send()
try {
  const res = await svc.sendText(user_id, toJid, text);
  
  if (!res.ok) {
    if (res.error === 'NOT_CONNECTED') {
      // ✅ Retorna erro específico
      throw new BadRequestException('Sessão não conectada');
    }
    // ... outros erros
  }
  
  return { status: 'sent', message_id: res.id };
} catch (err) {
  if (err instanceof BadRequestException) throw err;
  throw new InternalServerErrorException(err?.message);
}
```

## Tabela de Sincronização DB ↔ Baileys

| Evento Baileys | Estado DB Antes | Estado DB Depois | Ação |
|---|---|---|---|
| `connection='open'` | `reconnecting` | `connected` | Emit `connected` → Update DB |
| `connection='close'` (retry) | `connected` | `reconnecting` | Wait, retry socket |
| `connection='close'` (max retry) | `reconnecting` | `disconnected` | Emit `disconnected` → Update DB |
| `loggedOut` | `connected` | `disconnected` | Cleanup, mark disconnected |

## Race Conditions Prevenidas

### ✅ Antes (PROBLEMA)
```
createConnection()
  ├─ baileys.createSession()
  │  └─ events.emit('connected')
  │     └─ (NENHUM LISTENER!)
  └─ RETURN (listener não foi registrado ainda)

WhatsappService.onModuleInit() (registra listener DEPOIS)
```

### ✅ Depois (CORRIGIDO)
```
Application Start
  ├─ WhatsappService.onModuleInit()
  │  └─ baileys.events.on('connected', handler) ✅
  │  └─ baileys.events.on('disconnected', handler) ✅
  │
createConnection()
  ├─ DB.create({ status: 'reconnecting' }) ✅
  ├─ baileys.createSession()
  │  └─ events.emit('connected') ✅ (listener exists!)
  │     └─ handler encontra DB record e atualiza ✅
```

## Logging Key Points

```
[EXPECTED LOGS]

WhatsappService: Attaching BaileysManager.connected listener ✅
WhatsappService: Attaching BaileysManager.disconnected listener ✅

(quando conecta)
BaileysManager: Emitting connected for sessionId=... userId=... ✅
WhatsappService: baileys.connected event received ✅
WhatsappService: Updated DB session for user ... -> connected ✅

(quando desconecta)
BaileysManager: Emitting disconnected for sessionId=... userId=... ✅
WhatsappService: baileys.disconnected event received ✅
WhatsappService: Updated DB session for user ... -> disconnected ✅
```

## Performance Considerations

- **Polling Interval**: 500ms (filesystem check para QR/creds)
- **Reconnection Backoff**: 2s, 4s, 6s (exponencial)
- **Max Reconnection Attempts**: 3
- **Total timeout para conexão inicial**: 120s
- **DB queries**: Indexed on `userId` para lookup O(1)

## Segurança

- Credenciais armazenadas em `creds.json` no filesystem (produção: usar S3 ou vault)
- Session data serializado em JSON (produção: criptografar em repouso)
- Sem validação de phone number format (recomendado: adicionar regex)

