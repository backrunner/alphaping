use alphaping_protocol::v1::{LiveSessionCredential, MetricSample};
use anyhow::{Result, bail};
use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
};

use crate::spool::Spool;

mod client;
mod frame;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct LiveDemand {
    session_id: Vec<u8>,
    expires_at_ms: i64,
}

#[derive(Debug)]
struct OutboundFrame {
    session_id: Vec<u8>,
    bytes: Vec<u8>,
}

pub struct LiveHandle {
    credential_tx: watch::Sender<Option<LiveSessionCredential>>,
    credential_rx: watch::Receiver<Option<LiveSessionCredential>>,
    demand_rx: watch::Receiver<LiveDemand>,
    outbound_tx: mpsc::Sender<OutboundFrame>,
    task: JoinHandle<()>,
}

impl LiveHandle {
    pub fn start(machine_pk: u64) -> Self {
        let (credential_tx, credential_rx) = watch::channel(None);
        let task_credential_rx = credential_rx.clone();
        let (demand_tx, demand_rx) = watch::channel(LiveDemand::default());
        let (outbound_tx, outbound_rx) = mpsc::channel(2);
        let task = tokio::spawn(async move {
            client::run_live_client(machine_pk, task_credential_rx, demand_tx, outbound_rx).await;
        });
        Self {
            credential_tx,
            credential_rx,
            demand_rx,
            outbound_tx,
            task,
        }
    }

    pub fn update_credential(&self, credential: LiveSessionCredential, now_ms: i64) -> Result<()> {
        frame::validate_credential(&credential, now_ms)?;
        self.credential_tx.send_if_modified(|current| {
            if current.as_ref() == Some(&credential) {
                false
            } else {
                *current = Some(credential);
                true
            }
        });
        Ok(())
    }

    pub fn send_snapshot(
        &self,
        spool: &mut Spool,
        machine_pk: u64,
        sample: &MetricSample,
        now_ms: i64,
    ) -> Result<bool> {
        let credential = self.credential_rx.borrow().clone();
        let demand = self.demand_rx.borrow().clone();
        let Some(credential) = credential else {
            return Ok(false);
        };
        if credential.expires_at_ms <= now_ms
            || demand.expires_at_ms <= now_ms
            || demand.session_id != credential.session_id
        {
            return Ok(false);
        }
        let sequence = spool.next_live_sequence(&credential.session_id)?;
        let bytes = frame::seal_live_snapshot(&credential, machine_pk, sequence, sample)?;
        let outbound = OutboundFrame {
            session_id: credential.session_id,
            bytes,
        };
        match self.outbound_tx.try_send(outbound) {
            Ok(()) => Ok(true),
            Err(mpsc::error::TrySendError::Full(_)) => Ok(false),
            Err(mpsc::error::TrySendError::Closed(_)) => {
                bail!("live client task is unavailable")
            }
        }
    }
}

impl Drop for LiveHandle {
    fn drop(&mut self) {
        self.task.abort();
    }
}
