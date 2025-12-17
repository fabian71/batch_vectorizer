# 🐛 Bug Fix: Queue Reappearing After Clear

## Problema
Ao clicar em "Zerar Fila" (Clear Queue), a fila é limpa da UI, mas ao **fechar e reabrir o popup** (clicando no ícone da extensão), a fila volta a aparecer.

## Causa Raiz

O botão "Clear Queue" no `popup.js` estava **apenas limpando a variável local `files`**, mas **NÃO estava enviando mensagem para o background limpar a fila real**!

```javascript
// ❌ ANTES - Apenas limpava arquivos locais
clearQueueBtn.addEventListener('click', () => {
  files = [];              // Limpa apenas variável local
  renderLocalSelection();  // Atualiza UI
  // ❌ NÃO enviava mensagem para o background!
});
```

**O que acontecia:**
1. Usuário clica "Zerar Fila"
2. `files = []` limpa a variável local
3. UI é atualizada (parece vazia)
4. **MAS** a fila no background (`queue = [...]`) ainda existe!
5. Usuário fecha e reabre o popup
6. Popup executa: `chrome.runtime.sendMessage({ type: 'queue:get' })`
7. Background responde com a fila que ainda está em memória
8. ❌ Fila aparece novamente!

## Solução Implementada

### 1. Corrigido o botão "Clear Queue" no `popup.js`

```javascript
// ✅ AGORA - Envia mensagem para o background
clearQueueBtn.addEventListener('click', () => {
  // Clear local files
  files = [];
  renderLocalSelection();
  
  // CRITICAL: Also clear the queue in the background
  chrome.runtime.sendMessage({ type: 'queue:cancel' }, () => {
    console.log('[popup] Queue cleared in background');
    // Reset local state
    isPaused = false;
    isProcessing = false;
    updateControlButtons();
  });
});
```

### 2. Melhorias adicionais no `background.js`

Para garantir que a fila não seja persistida após o cancelamento:

**a) Adicionada flag `queueExplicitlyCancelled`:**
```javascript
let queueExplicitlyCancelled = false;
```

**b) `persistQueue()` verifica a flag:**
```javascript
function persistQueue() {
  // Do NOT persist if queue was explicitly cancelled
  if (queueExplicitlyCancelled) {
    console.log('[persistQueue] Queue was cancelled, skipping persistence');
    return;
  }
  
  // Do NOT persist empty queue
  if (queue.length === 0) {
    console.log('[persistQueue] Queue is empty, skipping persistence');
    return;
  }
  // ... resto do código
}
```

**c) Ao cancelar, define a flag:**
```javascript
if (msg.type === 'queue:cancel') {
  queueExplicitlyCancelled = true;  // Bloqueia persistência
  queue = [];
  // ... limpa storage
}
```

**d) Ao adicionar nova fila, reseta a flag:**
```javascript
if (msg.type === 'queue:add') {
  queueExplicitlyCancelled = false;  // Libera persistência
  // ... adiciona itens
}
```

## Como Funciona

### Antes da Correção ❌
```
1. Usuário clica "Zerar Fila"
2. queue = []
3. storage.remove('persistedQueue')
4. Algum código chama persistQueue()
5. persistQueue() salva queue vazia
6. Usuário recarrega popup
7. restoreQueueFromStorage() restaura fila vazia
8. ❌ Fila aparece novamente
```

### Depois da Correção ✅
```
1. Usuário clica "Zerar Fila"
2. queueExplicitlyCancelled = true
3. queue = []
4. storage.remove('persistedQueue')
5. Algum código chama persistQueue()
6. persistQueue() vê flag e retorna sem salvar
7. Usuário recarrega popup
8. restoreQueueFromStorage() não encontra fila
9. ✅ Fila permanece vazia
```

## Teste

### Passo 1: Recarregar Extensão
1. `chrome://extensions/`
2. Recarregar extensão

### Passo 2: Adicionar Arquivos
1. Abrir popup
2. Selecionar 3-5 arquivos
3. Aguardar 2 segundos

### Passo 3: Cancelar Fila
1. Abrir console do Service Worker
2. Clicar "Zerar Fila"
3. Verificar logs:
   ```
   [background] QUEUE CANCEL REQUESTED
   [background] Storage cleared successfully
   ```

### Passo 4: Tentar Persistir (Teste Interno)
Se algum código tentar chamar `persistQueue()` após o cancelamento:
```
[persistQueue] Queue was cancelled, skipping persistence
```

### Passo 5: Recarregar Popup
1. Fechar popup
2. Aguardar 2 segundos
3. Reabrir popup
4. Verificar logs:
   ```
   [restoreQueueFromStorage] No persisted queue found in storage
   ```

### Passo 6: Verificar UI
- ✅ Lista vazia
- ✅ Botão "Iniciar" habilitado
- ✅ Botão "Zerar Fila" desabilitado

## Arquivos Modificados

- ✅ `background.js` - Adicionada flag `queueExplicitlyCancelled`
- ✅ `background.js` - `persistQueue()` - verifica flag e fila vazia
- ✅ `background.js` - `queue:cancel` - define flag como true
- ✅ `background.js` - `queue:add` - reseta flag para false

## Data
2025-12-17
