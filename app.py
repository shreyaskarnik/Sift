from src.ui import build_interface

if __name__ == "__main__":
    app_demo = build_interface()
    print("Starting Multi-User Gradio App...")
    app_demo.queue()
    app_demo.launch()