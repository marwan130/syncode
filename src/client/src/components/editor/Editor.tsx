import Editor from '@monaco-editor/react';


function EditorComponent() {
    return (
        <Editor
            height="100vh"
            defaultLanguage="javascript"
            theme="vs-dark"
            defaultValue="// some comment"
        />
    );
}

export default EditorComponent;
