# BUG CORRIGIDO: Fila não avança após remover fundo

## 🐛 Problema Identificado

Quando a opção "remover fundo" estava ativada:
- ✅ A primeira imagem era processada com sucesso
- ✅ O download era feito corretamente
- ✅ A mensagem `poc:done` era enviada
- ❌ **A fila NÃO avançava para a próxima imagem**

## 🔍 Causa Raiz

O problema estava no **keep-alive mechanism**:

1. No início do `processFile()`, a função `startKeepAlive()` era chamada para manter o service worker ativo durante o processamento (linha 132)
2. O keep-alive iniciava um `setInterval` que enviava mensagens `keepAlive` a cada 10 segundos
3. **NUNCA** era chamado `stopKeepAlive()` ao final do processamento
4. Isso causava um conflito onde:
   - O keep-alive continuava enviando mensagens infinitamente
   - A mensagem `poc:done` era enviada, mas o background.js pode ter tido problemas para processar devido ao fluxo contínuo de mensagens keep-alive
   - O estado `isRunning` no background.js não era resetado corretamente
   - A função `kick()` não era chamada para processar a próxima imagem

## ✅ Solução Implementada

Adicionado `stopKeepAlive()` em todos os pontos de saída do processamento:

### 1. **Na função `sendDone()` (linha 669)**
```javascript
function sendDone(name, status, downloadUrl, err, meta = {}) {
  try {
    // CRITICAL: Stop keep-alive pings before sending done message
    stopKeepAlive();
    
    clearResumeFlag();
    // ... resto do código
```

**Motivo**: Esta é a função final chamada quando uma imagem é processada (com sucesso ou erro). Parar o keep-alive aqui garante que não haverá interferência com a próxima imagem.

### 2. **No caso de pricing redirect (linha 143)**
```javascript
if (!pricingHandled) {
  pricingHandled = true;
  log('[processFile] on pricing page, requesting retry and returning to home');
  stopKeepAlive(); // Stop keep-alive before redirecting
  requestRetry(item.name);
```

**Motivo**: Quando detecta a página de pricing, precisa parar o keep-alive antes de redirecionar.

### 3. **Quando input não é encontrado (linha 167)**
```javascript
if (!input) {
  log('[processFile] upload input not found after 10 seconds');
  stopKeepAlive(); // Stop keep-alive before retry
  requestRetry(item.name);
  return;
}
```

**Motivo**: Se o input de upload não for encontrado, o processamento falha e precisa limpar o keep-alive.

## 📊 Fluxo Correto Agora

```
Imagem 1 (com remover fundo):
  ├─ startKeepAlive() ✅
  ├─ Upload da imagem ✅
  ├─ Aguarda processamento ✅
  ├─ Remove fundo ✅
  ├─ Aguarda reprocessamento ✅
  ├─ Download ✅
  ├─ sendDone() ✅
  │   └─ stopKeepAlive() ✅ (NOVO!)
  └─ background.js recebe poc:done ✅
      └─ markDone() ✅
          └─ kick() ✅ (avança para próxima)

Imagem 2:
  ├─ startKeepAlive() ✅
  └─ ... (processo continua)
```

## 🎯 Resultado Esperado

Agora a fila deve avançar corretamente para todas as imagens, independentemente de usar ou não a opção "remover fundo".

## 🧪 Como Testar

1. Selecione 2 ou mais imagens
2. Ative a opção "Remover Fundo"
3. Inicie o processamento
4. Verifique que:
   - ✅ Primeira imagem processa e baixa
   - ✅ Segunda imagem inicia automaticamente
   - ✅ Todas as imagens são processadas em sequência
   - ✅ Não há loops infinitos de keep-alive

## 📝 Logs para Monitorar

```
[Vectorizer-Ext] [sendDone] <nome> done position: X total: Y
[Vectorizer-Ext] [stopKeepAlive] Stopping keep-alive pings
[background] Received poc:done for: <nome> status: done
[background] After markDone - isRunning: false isPaused: false
[kick] Called. isRunning: false isPaused: false queue.length: Y
[kick] Processing: <próxima imagem>
```
