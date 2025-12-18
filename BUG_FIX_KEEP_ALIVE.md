# 🐛 Bug Fix: Fila Para Após Primeira Imagem (com Remove Background)

## Data
2025-12-18

## Problema Reportado
Quando a opção "Remover Fundo" está ativada:
- ✅ Primeira imagem é processada corretamente
- ✅ Download é feito com sucesso
- ❌ **Fila NÃO avança para a próxima imagem**
- ❌ Extensão fica "travada"

**Sem "Remover Fundo"**: Funciona perfeitamente.

## Causa Raiz Identificada

### Análise dos Logs

**Log do content.js:**
```
[sendDone] 18_Flat_vector_illustration... done position: 1 total: 2
[sendDone] Success, response: > Object
```
✅ Mensagem enviada com sucesso

**Log do background.js:**
```
[restoreQueueFromStorage] ========== ATTEMPTING TO RESTORE QUEUE ==========
[restoreQueueFromStorage] No persisted queue found in storage
```
❌ O Service Worker reiniciou e perdeu a fila!

### O Problema

O fluxo era:

1. Primeira imagem processada (leva ~30-60s com "Remover Fundo")
2. `sendDone()` é chamado com sucesso
3. **`stopKeepAlive()` é chamado** (para de enviar pings ao background)
4. `markDone()` no background configura delay de 5 segundos
5. **Durante esse delay**, sem keep-alive, o Chrome suspende o Service Worker
6. Quando tenta chamar `kick()`, o Service Worker reinicia do zero
7. A fila em memória é perdida → Processamento para

### Por que sem "Remover Fundo" funciona?

- Processamento rápido (~5-10s por imagem)
- O delay entre imagens é curto
- O Service Worker não tem tempo de suspender

### Por que COM "Remover Fundo" trava?

- Processamento longo (~30-60s por imagem)
- `stopKeepAlive()` era chamado após CADA imagem
- Durante o delay de 5s, o Service Worker suspendia
- Fila era perdida

## Solução Implementada

### Modificação em `content.js` - função `sendDone()`

**Antes:**
```javascript
// CRITICAL: Stop keep-alive pings AFTER message is sent
stopKeepAlive();
```

**Depois:**
```javascript
// Check if this is the last image in the queue
const isLastImage = meta?.position && meta?.total && 
                    parseInt(meta.position) >= parseInt(meta.total);

// CRITICAL: Only stop keep-alive if this is the LAST image
if (isLastImage) {
    log('[sendDone] Last image processed, stopping keep-alive');
    stopKeepAlive();
} else {
    log('[sendDone] More images pending, keeping keep-alive active');
}
```

### Lógica da Correção

- Keep-alive agora continua ativo **até a última imagem ser processada**
- Isso mantém o Service Worker acordado durante todo o processamento
- Apenas quando `position >= total`, o keep-alive é parado

### Correção Adicional

Também adicionado `stopKeepAlive()` no handler de `queue:cancel` para garantir que os pings parem quando o usuário cancelar a fila.

## Arquivos Modificados

- `content.js`:
  - Função `sendDone()` - linha ~748
  - Handler `queue:cancel` - linha ~61

## Como Testar

1. Selecione 2 ou mais imagens
2. Ative a opção "Remover Fundo"
3. Inicie o processamento
4. Verifique nos logs:
   - `[sendDone] isLastImage: false` (para imagens intermediárias)
   - `[sendDone] More images pending, keeping keep-alive active`
   - `[sendDone] isLastImage: true` (para última imagem)
   - `[sendDone] Last image processed, stopping keep-alive`

## Resultado Esperado

- ✅ Todas as imagens são processadas em sequência
- ✅ O Service Worker permanece ativo durante todo o processamento
- ✅ A fila não é perdida entre imagens
