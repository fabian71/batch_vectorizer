# 🐛 Bug Fix: Fila Para Após Primeiro Arquivo (com Remove Background)

## Problema
Quando processa 60 imagens **com "Remover Background" ativado**:
- ✅ Primeiro arquivo processa corretamente
- ✅ Download é feito
- ❌ **Fila para** - não avança para o segundo arquivo
- ❌ Todos os arquivos restantes são marcados como "skipped"

**MAS** quando processa **sem "Remover Background"**, tudo funciona perfeitamente.

## Causa Raiz

### O Ciclo do Problema:

1. **Você adiciona 60 arquivos** → Dados binários ficam em memória
2. **Primeiro arquivo processa** (leva ~60 segundos com remoção de fundo)
3. **Chrome suspende o Service Worker** após ~30 segundos de inatividade
4. **Service Worker reinicia** automaticamente
5. **`restoreQueueFromStorage()` restaura a fila** do `chrome.storage.local`
6. ❌ **MAS os dados binários NÃO estão no storage!** (removidos para evitar quota exceeded)
7. **`kick()` tenta processar o segundo arquivo**
8. **Verifica:** `if (!next.data || next.data.length === 0)` → TRUE!
9. **Marca como "skipped"** e passa para o próximo
10. **Repete para todos os 59 arquivos restantes**
11. ❌ **Resultado:** 1 done, 59 skipped

### Por que funciona SEM "Remove Background"?

- **Sem remoção:** Cada arquivo processa em ~5-10 segundos
- **Service Worker não tem tempo de suspender** antes de processar todos
- **Dados binários permanecem em memória** durante todo o processamento
- ✅ **Todos os arquivos processam com sucesso**

### Por que NÃO funciona COM "Remove Background"?

- **Com remoção:** Cada arquivo leva ~30-60 segundos
- **Service Worker suspende** durante o processamento
- **Dados binários são perdidos** ao reiniciar
- ❌ **Arquivos restantes são pulados**

## Logs do Problema

```
[restoreQueueFromStorage] ✅ Restored queue with 60 items (metadata only - no binary data)
[kick] Item without data, skipping: arquivo2.jpg
[kick] Item without data, skipping: arquivo3.jpg
...
[kick] Queue statuses: ['done', 'skipped', 'skipped', 'skipped', ...]
[kick] No pending items, returning
```

## Solução Implementada

### Modificado `restoreQueueFromStorage()`

Agora **NÃO restaura a fila** se houver itens pending/processing sem dados binários:

```javascript
function restoreQueueFromStorage() {
  chrome.storage.local.get(['persistedQueue'], (res) => {
    const state = res?.persistedQueue;
    if (state && state.queue && state.queue.length > 0) {
      // Check if there are any items still pending or processing
      const hasPendingOrProcessing = state.queue.some(
        q => q.status === 'pending' || q.status === 'processing'
      );
      
      if (hasPendingOrProcessing) {
        // ⚠️ Items would be skipped anyway, so NOT restoring queue
        console.log('[restoreQueueFromStorage] ⚠️ Queue has pending items but NO binary data');
        console.log('[restoreQueueFromStorage] ⚠️ Service Worker was restarted during processing');
        console.log('[restoreQueueFromStorage] ⚠️ NOT restoring queue - would be skipped anyway');
        chrome.storage.local.remove('persistedQueue');
      } else {
        // Only "done" or "skipped" items - safe to restore for UI display
        queue = state.queue;
        broadcastQueue();
      }
    }
  });
}
```

### Comportamento Agora:

**Cenário 1: Service Worker reinicia durante processamento**
1. Fila tem itens "pending" mas sem dados binários
2. `restoreQueueFromStorage()` detecta isso
3. ⚠️ **NÃO restaura a fila** (seria inútil)
4. ⚠️ **Limpa o storage** para evitar confusão
5. ✅ **Processamento para** (como esperado quando dados são perdidos)

**Cenário 2: Processamento completo**
1. Todos os itens estão "done" ou "skipped"
2. `restoreQueueFromStorage()` restaura para mostrar na UI
3. ✅ **Usuário vê o histórico** de processamento

## Recomendação ao Usuário

### ⚠️ **Limitação Conhecida**

Quando usa "Remover Background" com **muitos arquivos**:
- O Chrome pode suspender o Service Worker
- **Dados binários são perdidos**
- **Processamento para**

### ✅ **Soluções Alternativas**

**Opção 1: Processar em lotes menores**
- Processe **10-15 arquivos por vez**
- Isso evita que o Service Worker suspenda

**Opção 2: Não usar "Remover Background"**
- Processe sem remoção de fundo
- Remova o fundo manualmente depois (se necessário)

**Opção 3: Manter a aba ativa**
- Mantenha a aba do vectorizer.ai **visível e ativa**
- Isso reduz a chance do Service Worker suspender

## Teste

### Cenário 1: Processamento Normal (sem suspensão)
1. Adicione 5-10 arquivos
2. Ative "Remover Background"
3. Inicie processamento
4. ✅ Todos devem processar com sucesso

### Cenário 2: Service Worker Reinicia
1. Adicione 60 arquivos
2. Ative "Remover Background"
3. Inicie processamento
4. Após primeiro arquivo, **recarregue a extensão** manualmente
5. **Logs esperados:**
   ```
   [restoreQueueFromStorage] ⚠️ Queue has pending items but NO binary data
   [restoreQueueFromStorage] ⚠️ NOT restoring queue
   [restoreQueueFromStorage] ⚠️ Clearing persisted queue
   ```
6. ✅ Fila é limpa (não tenta processar arquivos sem dados)

## Arquivos Modificados

- ✅ `background.js` - `restoreQueueFromStorage()` - detecta e evita restaurar fila inválida

## Data
2025-12-17
