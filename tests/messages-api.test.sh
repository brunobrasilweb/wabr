#!/bin/bash

# WhatsApp Messages API - Script de Testes
# Este script valida todos os endpoints da API de mensagens

BASE_URL="http://localhost:8080/api"
TOKEN="test-token-123"  # Use um token válido

echo "=========================================="
echo "WhatsApp Messages API - Test Suite"
echo "=========================================="
echo ""

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ========================
# 1. ENVIAR MENSAGEM DE TEXTO
# ========================
echo -e "${YELLOW}[1] Enviando mensagem de TEXTO...${NC}"
RESPONSE=$(curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "text",
    "text": "Olá! Esta é uma mensagem de teste."
  }')

MESSAGE_ID=$(echo $RESPONSE | jq -r '.messageId')
echo "Response: $RESPONSE"
echo -e "${GREEN}✓ Message ID: $MESSAGE_ID${NC}"
echo ""

# ========================
# 2. CONSULTAR MENSAGEM
# ========================
echo -e "${YELLOW}[2] Consultando status da mensagem...${NC}"
sleep 2  # Espera um pouco para processamento

curl -s -X GET "${BASE_URL}/messages/${MESSAGE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
echo ""

# ========================
# 3. ENVIAR IMAGEM
# ========================
echo -e "${YELLOW}[3] Enviando IMAGEM...${NC}"
RESPONSE=$(curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511988888888",
    "type": "image",
    "mediaUrl": "https://via.placeholder.com/150",
    "caption": "Esta é uma imagem de teste"
  }')

IMAGE_MESSAGE_ID=$(echo $RESPONSE | jq -r '.messageId')
echo "Response: $RESPONSE"
echo -e "${GREEN}✓ Image Message ID: $IMAGE_MESSAGE_ID${NC}"
echo ""

# ========================
# 4. ENVIAR VÍDEO
# ========================
echo -e "${YELLOW}[4] Enviando VÍDEO...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511977777777",
    "type": "video",
    "mediaUrl": "https://example.com/video.mp4",
    "caption": "Um video interessante"
  }' | jq .
echo ""

# ========================
# 5. ENVIAR ÁUDIO
# ========================
echo -e "${YELLOW}[5] Enviando ÁUDIO...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511966666666",
    "type": "audio",
    "mediaUrl": "https://example.com/audio.ogg"
  }' | jq .
echo ""

# ========================
# 6. ENVIAR DOCUMENTO
# ========================
echo -e "${YELLOW}[6] Enviando DOCUMENTO...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511955555555",
    "type": "document",
    "mediaUrl": "https://example.com/documento.pdf",
    "caption": "Documento importante"
  }' | jq .
echo ""

# ========================
# 7. ENVIAR LOCALIZAÇÃO
# ========================
echo -e "${YELLOW}[7] Enviando LOCALIZAÇÃO...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511944444444",
    "type": "location",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "caption": "São Paulo, Brasil"
  }' | jq .
echo ""

# ========================
# 8. ENVIAR CONTATO
# ========================
echo -e "${YELLOW}[8] Enviando CONTATO...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511933333333",
    "type": "contact",
    "name": "João Silva",
    "phone": "5511988888888"
  }' | jq .
echo ""

# ========================
# 9. ENCAMINHAR MENSAGEM
# ========================
echo -e "${YELLOW}[9] Encaminhando mensagem para múltiplos destinatários...${NC}"
curl -s -X POST "${BASE_URL}/messages/forward" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"messageId\": \"${MESSAGE_ID}\",
    \"recipients\": [
      \"5511977777777\",
      \"5511966666666\",
      \"5511955555555\"
    ]
  }" | jq .
echo ""

# ========================
# 10. RECEBER MENSAGEM (Webhook)
# ========================
echo -e "${YELLOW}[10] Simulando recebimento de mensagem (Webhook)...${NC}"
curl -s -X POST "${BASE_URL}/messages/receive" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "5511988888888",
    "messageId": "wamsgid_webhook_test_001",
    "type": "text",
    "text": "Olá! Recebi sua mensagem!",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq .
echo ""

# ========================
# 11. TESTAR DUPLICATA
# ========================
echo -e "${YELLOW}[11] Testando detecção de duplicata...${NC}"
curl -s -X POST "${BASE_URL}/messages/receive" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "5511988888888",
    "messageId": "wamsgid_webhook_test_001",
    "type": "text",
    "text": "Mensagem duplicada",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq .
echo ""

# ========================
# 12. DELETAR MENSAGEM
# ========================
echo -e "${YELLOW}[12] Deletando mensagem...${NC}"
curl -s -X DELETE "${BASE_URL}/messages/${MESSAGE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
echo ""

# ========================
# 13. TESTAR ERRO - Número inválido
# ========================
echo -e "${YELLOW}[13] Testando validação - Número inválido...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "123",
    "type": "text",
    "text": "Isto vai falhar"
  }' | jq .
echo ""

# ========================
# 14. TESTAR ERRO - Tipo inválido
# ========================
echo -e "${YELLOW}[14] Testando validação - Tipo de mensagem inválida...${NC}"
curl -s -X POST "${BASE_URL}/messages/send" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "invalid_type",
    "text": "Isto vai falhar"
  }' | jq .
echo ""

echo -e "${GREEN}=========================================="
echo "✓ Testes completados!"
echo "==========================================${NC}"
echo ""
echo "Notas:"
echo "- As mensagens foram enfileiradas e começaram a ser processadas"
echo "- Verifique os logs da aplicação para status de processamento"
echo "- O WhatsApp pode demorar alguns segundos para entregar"
echo "- Use o ID da mensagem para consultar o status atualizado"
