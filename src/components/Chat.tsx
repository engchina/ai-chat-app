import React, {useState, useEffect, useRef} from 'react';
import {Message} from '../types/chat';
import {fetchChatResponse} from '../services/openaiService';
import {NetworkError, ClientError, ServerError} from '../types/error';

const Chat: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async () => {
        if (input.trim() === '' || isLoading) return;

        const newMessage: Message = {role: 'user', content: input.trim()};
        setMessages(prev => [...prev, newMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const stream = await fetchChatResponse([...messages, newMessage]);
            if (!stream) {
                throw new Error('Failed to get stream from response');
            }

            const reader = stream.getReader();
            const decoder = new TextDecoder('utf-8');
            let accumulatedData = '';

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                accumulatedData += decoder.decode(value, {stream: true});
                const lines = accumulatedData.split('\n');
                accumulatedData = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            console.log('Stream complete');
                            break;
                        } else {
                            try {
                                const json = JSON.parse(data);
                                if (json.choices?.[0]?.delta?.content) {
                                    setMessages(prev => {
                                        const lastMessage = prev[prev.length - 1];
                                        if (lastMessage?.role === 'assistant') {
                                            return [
                                                ...prev.slice(0, -1),
                                                {
                                                    ...lastMessage,
                                                    content: lastMessage.content + json.choices[0].delta.content,
                                                },
                                            ];
                                        } else {
                                            return [
                                                ...prev,
                                                {role: 'assistant', content: json.choices[0].delta.content},
                                            ];
                                        }
                                    });
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in chat:', error);

            let errorMessage = 'Sorry, there was an error processing your request.';
            if (error instanceof NetworkError) {
                errorMessage = 'Network connection failed. Please check your internet.';
            } else if (error instanceof ClientError) {
                errorMessage = `Client error (${error.statusCode}): ${error.message}`;
            } else if (error instanceof ServerError) {
                errorMessage = `Server error (${error.statusCode}): Please try again later.`;
            }

            setMessages(prev => [
                ...prev,
                {role: 'assistant', content: errorMessage},
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="chat-container">
            <header className="chat-header">
                <h1>AI Chatbot</h1>
            </header>

            <div className="chat-window">
                {messages.map((message, index) => (
                    <div key={index} className={`message ${message.role}`}>
                        <div className="message-content">{message.content}</div>
                    </div>
                ))}
                <div ref={messagesEndRef}/>
            </div>
            <div className="chat-input">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    disabled={isLoading}
                />
                <button
                    onClick={handleSendMessage}
                    disabled={isLoading || input.trim() === ''}
                >
                    {isLoading ? 'Sending...' : 'Send'}
                </button>
            </div>
        </div>
    );
};

export default Chat;