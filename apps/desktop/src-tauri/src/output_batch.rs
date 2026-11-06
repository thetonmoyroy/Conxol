use std::time::Duration;
use conxol_core::OutputBatcher;

/// Count/time-bounded native progress updates. Terminal events drain the tail.
pub(crate) struct ProgressBatch<T> {
    pending: Vec<T>,
    max_items: usize,
    cadence: Duration,
    last_flush: std::time::Instant,
}
impl<T> ProgressBatch<T> {
    pub(crate) fn new(max_items: usize, cadence: Duration, now: std::time::Instant) -> Self {
        assert!(max_items > 0);
        Self {
            pending: Vec::with_capacity(max_items),
            max_items,
            cadence,
            last_flush: now,
        }
    }
    pub(crate) fn push(&mut self, item: T, now: std::time::Instant) -> Option<Vec<T>> {
        self.pending.push(item);
        if self.pending.len() >= self.max_items
            || now.duration_since(self.last_flush) >= self.cadence
        {
            self.last_flush = now;
            Some(self.take())
        } else {
            None
        }
    }
    pub(crate) fn take(&mut self) -> Vec<T> {
        std::mem::take(&mut self.pending)
    }
}

/// Bounded native output coalescing with a fixed flush cadence, not an idle
/// timeout: continuous small reads must not postpone interactive output.
pub(crate) struct ShellOutputBatch<F: FnMut(&[u8])> {
    batcher: OutputBatcher,
    interval: tokio::time::Interval,
    emit: F,
}

impl<F: FnMut(&[u8])> ShellOutputBatch<F> {
    pub(crate) fn new(max_bytes: usize, cadence: Duration, emit: F) -> Self {
        let mut interval = tokio::time::interval_at(tokio::time::Instant::now() + cadence, cadence);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        Self {
            batcher: OutputBatcher::new(max_bytes),
            interval,
            emit,
        }
    }
    pub(crate) fn push(&mut self, bytes: &[u8]) {
        for chunk in self.batcher.push(bytes) {
            (self.emit)(&chunk.bytes);
        }
    }
    pub(crate) fn flush(&mut self) {
        if let Some(chunk) = self.batcher.flush() {
            (self.emit)(&chunk.bytes);
        }
    }
    pub(crate) async fn tick(&mut self) {
        self.interval.tick().await;
        self.flush();
    }
}

impl<F: FnMut(&[u8])> Drop for ShellOutputBatch<F> {
    fn drop(&mut self) {
        self.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn progress_is_count_bounded_and_retains_the_final_partial_batch() {
        let now = std::time::Instant::now();
        let mut batch = ProgressBatch::new(64, Duration::from_millis(100), now);
        for item in 0..63 {
            assert!(batch.push(item, now).is_none());
        }
        assert_eq!(batch.push(63, now).unwrap(), (0..64).collect::<Vec<_>>());
        assert!(batch.push(64, now).is_none());
        assert_eq!(batch.take(), vec![64]);
        assert!(batch.take().is_empty());
    }

    #[test]
    fn slow_progress_flushes_on_the_next_result_after_the_interval() {
        let now = std::time::Instant::now();
        let mut batch = ProgressBatch::new(64, Duration::from_millis(100), now);
        assert!(batch.push(1, now).is_none());
        assert_eq!(
            batch.push(2, now + Duration::from_millis(100)),
            Some(vec![1, 2])
        );
        assert!(batch.push(3, now + Duration::from_millis(101)).is_none());
        assert_eq!(batch.take(), vec![3]);
    }

    #[tokio::test]
    async fn byte_reads_are_coalesced_and_flushed_on_cadence() {
        let chunks = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let captured = Arc::clone(&chunks);
        let mut output = ShellOutputBatch::new(32768, Duration::from_millis(8), move |bytes| {
            captured.lock().unwrap().push(bytes.to_vec())
        });
        for _ in 0..1000 {
            output.push(b"x");
        }
        assert!(chunks.lock().unwrap().is_empty());
        tokio::time::timeout(Duration::from_secs(1), output.tick())
            .await
            .unwrap();
        assert_eq!(*chunks.lock().unwrap(), vec![vec![b'x'; 1000]]);
    }

    #[tokio::test]
    async fn size_cap_and_teardown_preserve_every_byte_in_order() {
        let chunks = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let captured = Arc::clone(&chunks);
        {
            let mut output = ShellOutputBatch::new(4, Duration::from_millis(8), move |bytes| {
                captured.lock().unwrap().push(bytes.to_vec())
            });
            output.push("abc€xyz".as_bytes());
            output.push(b"!");
        }
        let chunks = chunks.lock().unwrap();
        assert!(chunks.iter().all(|chunk| chunk.len() <= 4));
        assert_eq!(chunks.concat(), "abc€xyz!".as_bytes());
        let mut decoder = conxol_core::Utf8OutputDecoder::default();
        let text: String = chunks.iter().map(|chunk| decoder.push(chunk)).collect();
        assert_eq!(text, "abc€xyz!");
        assert!(decoder.finish().is_empty());
    }
}
