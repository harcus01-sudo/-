import { useState, useRef, useEffect } from "react";
import { Upload, Leaf, MessageSquare, Loader2, Send, Image as ImageIcon, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import { identifyPlant, createGardeningChat, generatePlantImage } from "./services/geminiService";

const CHAT_STORAGE_KEY = "sprout_ai_chat_history";

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [plantInfo, setPlantInfo] = useState<string | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "model"; text: string }[]>(() => {
    const saved = localStorage.getItem(CHAT_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const clearChat = () => {
    if (window.confirm("确定要清空聊天记录吗？")) {
      setChatMessages([]);
      localStorage.removeItem(CHAT_STORAGE_KEY);
      chatRef.current = null;
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      setImage(base64String);
      setPlantInfo(null);
      setIsIdentifying(true);

      try {
        // Extract base64 data and mime type
        const match = base64String.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          const mimeType = match[1];
          const data = match[2];
          const info = await identifyPlant(data, mimeType);
          setPlantInfo(info || "无法识别该植物。");
          
          // Initialize chat with context
          const chat = createGardeningChat();
          chatRef.current = chat;
          
          // Seed the chat with the plant info so it knows what we are talking about
          // We can't easily seed the chat history directly with the @google/genai SDK without sending a message,
          // so we'll just let the user ask questions, and if they do, we'll prepend context to their first message if needed,
          // or we can just send a hidden message to the chat.
          await chat.sendMessage({ message: `我刚刚上传了一张植物的照片。你对它的识别结果如下：\n\n${info}\n\n请在回答我后续的问题时记住这些信息。` });
          
          setChatMessages((prev) => [
            ...prev,
            { role: "model", text: "我已经识别出您的植物了！如果您有任何关于养护它的问题，请随时问我。" }
          ]);
        }
      } catch (error) {
        console.error("Error identifying plant:", error);
        setPlantInfo("识别植物时发生错误，请重试。");
      } finally {
        setIsIdentifying(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatting) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [
      ...prev, 
      { role: "user", text: userMessage },
      { role: "model", text: "" }
    ]);
    setIsChatting(true);

    try {
      if (!chatRef.current) {
        chatRef.current = createGardeningChat();
      }
      
      const streamResponse = await chatRef.current.sendMessageStream({ message: userMessage });
      let fullText = "";
      for await (const chunk of streamResponse) {
        const chunkText = chunk.text || "";
        if (chunkText) {
          fullText += chunkText;
          setChatMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              text: fullText
            };
            return newMessages;
          });
        }
      }
      
      // Check for image generation tags
      let finalMessageText = fullText;
      const imageMatches = [...fullText.matchAll(/\[GENERATE_IMAGE:\s*(.+?)\]/g)];
      
      if (imageMatches.length > 0) {
        let loadingText = fullText;
        imageMatches.forEach(match => {
          loadingText = loadingText.replace(match[0], `\n\n*(🎨 正在为您生成图片，请稍候...)*\n\n`);
        });
        
        setChatMessages((prev) => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1].text = loadingText;
          return newMsgs;
        });
        
        await Promise.all(imageMatches.map(async (match) => {
          const imagePrompt = match[1];
          try {
            const imageUrl = await generatePlantImage(imagePrompt);
            if (imageUrl) {
              finalMessageText = finalMessageText.replace(match[0], `\n\n![${imagePrompt}](${imageUrl})\n\n`);
            } else {
              finalMessageText = finalMessageText.replace(match[0], `\n\n*(❌ 图片生成失败)*\n\n`);
            }
          } catch (err) {
            console.error("Image generation error:", err);
            finalMessageText = finalMessageText.replace(match[0], `\n\n*(❌ 图片生成失败)*\n\n`);
          }
        }));
        
        setChatMessages((prev) => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1].text = finalMessageText;
          return newMsgs;
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setChatMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        if (!newMessages[lastIndex].text) {
          newMessages[lastIndex].text = "抱歉，我遇到了一些错误，请重试。";
        } else {
          newMessages[lastIndex].text += "\n\n[连接中断，请重试]";
        }
        return newMessages;
      });
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-emerald-200">
      <header className="bg-emerald-800 text-emerald-50 py-6 px-4 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Leaf className="w-8 h-8 text-emerald-300" />
          <h1 className="text-2xl font-semibold tracking-tight">绿芽 AI</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Image Upload & Plant Info */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
            <h2 className="text-xl font-medium mb-4 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-emerald-600" />
              识别植物
            </h2>
            
            {!image ? (
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-stone-300 rounded-xl cursor-pointer bg-stone-50 hover:bg-stone-100 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 text-stone-400 mb-3" />
                  <p className="mb-2 text-sm text-stone-600 font-medium">点击上传照片</p>
                  <p className="text-xs text-stone-500">支持 PNG, JPG, 或 WEBP (最大 5MB)</p>
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
              </label>
            ) : (
              <div className="space-y-4">
                <div className="relative w-full h-64 rounded-xl overflow-hidden bg-stone-100 border border-stone-200">
                  <img src={image} alt="Uploaded plant" className="w-full h-full object-contain" />
                  <label className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm cursor-pointer hover:bg-white transition-colors border border-stone-200">
                    更换照片
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </label>
                </div>
              </div>
            )}
          </section>

          {(isIdentifying || plantInfo) && (
            <section className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
              <h2 className="text-xl font-medium mb-4 flex items-center gap-2">
                <Leaf className="w-5 h-5 text-emerald-600" />
                植物信息与养护
              </h2>
              
              {isIdentifying ? (
                <div className="flex flex-col items-center justify-center py-12 text-stone-500">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-4" />
                  <p className="font-medium">正在分析您的植物...</p>
                  <p className="text-sm mt-1">这可能需要几秒钟的时间。</p>
                </div>
              ) : (
                <div className="prose prose-stone prose-emerald max-w-none prose-headings:font-medium prose-h3:text-lg prose-p:leading-relaxed">
                  <Markdown>{plantInfo}</Markdown>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right Column: Chatbot */}
        <div className="lg:col-span-5 h-[600px] lg:h-[calc(100vh-8rem)] sticky top-8">
          <section className="bg-white rounded-2xl shadow-sm border border-stone-200 flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
                <h2 className="font-medium">园艺助手</h2>
              </div>
              {chatMessages.length > 0 && (
                <button 
                  onClick={clearChat}
                  className="text-stone-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-stone-100"
                  title="清空聊天记录"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-stone-50/30">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-stone-500 p-6">
                  <MessageSquare className="w-12 h-12 text-stone-200 mb-4" />
                  <p className="font-medium text-stone-600">有什么问题吗？</p>
                  <p className="text-sm mt-1">您可以先上传一张植物照片，或者直接问我任何关于园艺的问题！</p>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === "user" 
                        ? "bg-emerald-600 text-white rounded-tr-sm" 
                        : "bg-white border border-stone-200 text-stone-800 rounded-tl-sm shadow-sm"
                    }`}>
                      {msg.role === "model" ? (
                        <div className="prose prose-sm prose-stone max-w-none">
                          {msg.text ? (
                            <Markdown>{msg.text}</Markdown>
                          ) : (
                            <div className="flex items-center gap-2 text-stone-500 h-6">
                              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                              <span className="text-sm">正在思考...</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm">{msg.text}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <div className="p-4 bg-white border-t border-stone-100">
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="询问关于浇水、土壤等问题..."
                  className="flex-1 bg-stone-100 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
                  disabled={isChatting}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isChatting}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white p-2.5 rounded-xl transition-colors flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
