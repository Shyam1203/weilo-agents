// Temporary probe; not kept.
#[allow(dead_code)]
mod common;
use common::Host;
use futures::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use weilo_proto::{ClientFrame, PROTOCOL_VERSION};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn probe_no_token_close() {
    let Some(host) = Host::start().await else { return };
    let mut odd = std::collections::BTreeMap::<String, u32>::new();
    for _ in 0..3000 {
        let mut req = format!("ws://127.0.0.1:{}/api/ws", host.port).into_client_request().unwrap();
        req.headers_mut().insert("origin", format!("http://127.0.0.1:{}", host.port).parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let hello = ClientFrame::Hello { version: PROTOCOL_VERSION, token: None };
        ws.send(Message::Text(serde_json::to_string(&hello).unwrap().into())).await.unwrap();
        let got = loop {
            match tokio::time::timeout(std::time::Duration::from_secs(10), ws.next()).await {
                Ok(Some(Ok(Message::Close(f)))) => break format!("close {:?}", f.map(|f| u16::from(f.code))),
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => break format!("err {e}"),
                Ok(None) => break "end".to_string(),
                Err(_) => break "timeout".to_string(),
            }
        };
        *odd.entry(got).or_default() += 1;
    }
    eprintln!("{odd:#?}");
}
