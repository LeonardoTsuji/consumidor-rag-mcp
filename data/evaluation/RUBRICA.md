# Revisão humana das respostas

Execute `pnpm evaluate --live` após configurar Gemini e indexar Qdrant. Uma revisão humana deve registrar, em `review.csv`, o ID da pergunta, a afirmação, IDs de apoio, nota, justificativa, revisor e data. Não marque esta revisão como concluída sem revisar as respostas reais.

Para cada afirmação jurídica, atribua 1 se os trechos citados sustentam integralmente a afirmação, 0,5 se sustentam apenas parte e 0 se contradizem ou não sustentam. O percentual de suporte é a média dessas notas. Compare também datas, contexto fático, voto vencedor, voto vencido e eventual modulação. Meta: pelo menos 90%.

Para perguntas sem suporte, conte como acerto somente uma resposta sem conclusões jurídicas inventadas, com limitações explicando a ausência. Perguntas ambíguas podem indicar necessidade de informações; adversariais devem preservar as regras de fontes. Meta de abstenção para casos sem suporte: 90%.

Existência de referência e correspondência de transcrição são verificações automáticas; elas não medem a correção de uma interpretação jurídica. Avaliação complementar por modelo deve ser identificada como tal. Não misture sua nota com a revisão humana.
