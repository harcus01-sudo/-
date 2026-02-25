import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function identifyPlant(base64Image: string, mimeType: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType,
          },
        },
        {
          text: "你是一位植物学专家和园艺助手。请识别这种植物，并提供详细的养护说明，包括浇水、日照、土壤和温度要求。请使用简体中文，并以美观的Markdown格式输出。",
        },
      ],
    },
  });
  return response.text;
}

export async function generatePlantImage(prompt: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
      }
    }
  });
  
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

export function createGardeningChat() {
  return ai.chats.create({
    model: "gemini-3.1-pro-preview",
    config: {
      systemInstruction: "你是一位乐于助人、友好且知识渊博的园艺助手。请回答有关植物、园艺和植物养护的问题。如果用户询问他们刚刚上传的特定植物，请利用对话上下文来帮助他们。请始终使用简体中文回答。\n\n**重要提示**：如果用户想看某种植物、花卉的照片，或者你认为展示照片有助于解释，请在回复中包含特殊指令 `[GENERATE_IMAGE: 详细的英文画面描述]`。注意，画面描述必须翻译成**英文**，因为画图AI只懂英文。例如：`[GENERATE_IMAGE: A beautiful blooming purple iris flower, natural lighting, macro photography]`。系统会自动将此指令替换为真实的图片显示给用户。",
    },
  });
}
