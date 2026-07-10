#[tokio::main]
async fn main() {
    env_logger::init();
    seaquel_lib::server::run_server().await;
}
